package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	GeminiAPIURL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent"
)

// GeminiClient is the Google Gemini API client
type GeminiClient struct {
	apiKey     string
	httpClient *http.Client
}

// NewGeminiClient creates a new Gemini API client
func NewGeminiClient() *GeminiClient {
	apiKey := os.Getenv("GEMINI_API_KEY")
	return &GeminiClient{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// GeminiRequest represents a request to Gemini API
type GeminiRequest struct {
	Contents         []Content         `json:"contents"`
	GenerationConfig *GenerationConfig `json:"generationConfig,omitempty"`
}

// Content represents content in a Gemini request
type Content struct {
	Parts []Part `json:"parts"`
}

// Part represents a part of content
type Part struct {
	Text string `json:"text"`
}

// GenerationConfig contains generation parameters
type GenerationConfig struct {
	Temperature     float64 `json:"temperature,omitempty"`
	TopK            int     `json:"topK,omitempty"`
	TopP            float64 `json:"topP,omitempty"`
	MaxOutputTokens int     `json:"maxOutputTokens,omitempty"`
}

// GeminiResponse represents a response from Gemini API
type GeminiResponse struct {
	Candidates []Candidate `json:"candidates"`
	Error      *GeminiError `json:"error,omitempty"`
}

// Candidate represents a response candidate
type Candidate struct {
	Content Content `json:"content"`
}

// GeminiError represents an API error
type GeminiError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Status  string `json:"status"`
}

// TaskStatusAnalysis represents the AI's analysis of a task's status
type TaskStatusAnalysis struct {
	TaskTitle      string   `json:"task_title"`
	DetectedStatus string   `json:"detected_status"` // "completed", "in_progress", "blocked", "not_started"
	Confidence     float64  `json:"confidence"`       // 0.0 to 1.0
	Evidence       []string `json:"evidence"`         // Relevant message snippets
	MessageIDs     []string `json:"message_ids"`      // IDs of messages that contributed to this analysis
}

// SlackMessageForAnalysis represents a message for AI analysis
type SlackMessageForAnalysis struct {
	ID        string `json:"id"`
	UserName  string `json:"user_name"`
	Text      string `json:"text"`
	Timestamp string `json:"timestamp"`
}

// AnalyzeMessages analyzes Slack messages to determine task statuses
func (c *GeminiClient) AnalyzeMessages(ctx context.Context, messages []SlackMessageForAnalysis, taskTitles []string) ([]TaskStatusAnalysis, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("GEMINI_API_KEY environment variable not set")
	}

	// Build the prompt
	prompt := buildAnalysisPrompt(messages, taskTitles)

	// Create request
	req := GeminiRequest{
		Contents: []Content{
			{
				Parts: []Part{
					{Text: prompt},
				},
			},
		},
		GenerationConfig: &GenerationConfig{
			Temperature:     0.2, // Low temperature for more deterministic output
			MaxOutputTokens: 2048,
		},
	}

	// Make API request
	jsonBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	url := fmt.Sprintf("%s?key=%s", GeminiAPIURL, c.apiKey)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var geminiResp GeminiResponse
	if err := json.Unmarshal(body, &geminiResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if geminiResp.Error != nil {
		return nil, fmt.Errorf("API error: %s", geminiResp.Error.Message)
	}

	if len(geminiResp.Candidates) == 0 || len(geminiResp.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("no response from Gemini")
	}

	// Parse the AI's response
	responseText := geminiResp.Candidates[0].Content.Parts[0].Text
	return parseAnalysisResponse(responseText, taskTitles)
}

// buildAnalysisPrompt creates the prompt for Gemini
func buildAnalysisPrompt(messages []SlackMessageForAnalysis, taskTitles []string) string {
	var sb strings.Builder

	sb.WriteString("You are an AI assistant that analyzes Slack messages to determine the status of tasks.\n\n")
	sb.WriteString("## Task List:\n")
	for i, title := range taskTitles {
		sb.WriteString(fmt.Sprintf("%d. %s\n", i+1, title))
	}

	sb.WriteString("\n## Slack Messages (from yesterday):\n")
	for _, msg := range messages {
		sb.WriteString(fmt.Sprintf("[%s] %s: %s\n", msg.Timestamp, msg.UserName, msg.Text))
	}

	sb.WriteString("\n## Instructions:\n")
	sb.WriteString("Analyze the messages and determine the status of each task.\n")
	sb.WriteString("Look for keywords and phrases that indicate:\n")
	sb.WriteString("- COMPLETED: \"done\", \"finished\", \"completed\", \"merged\", \"deployed\", \"fixed\", \"resolved\", \"closed\", \"shipped\"\n")
	sb.WriteString("- IN_PROGRESS: \"working on\", \"still doing\", \"in progress\", \"almost done\", \"halfway\", \"debugging\"\n")
	sb.WriteString("- BLOCKED: \"blocked\", \"stuck\", \"waiting\", \"need help\", \"can't proceed\"\n")
	sb.WriteString("- NOT_STARTED: No mentions or \"haven't started\", \"will start\"\n\n")

	sb.WriteString("## Output Format (JSON array):\n")
	sb.WriteString("```json\n")
	sb.WriteString("[\n")
	sb.WriteString("  {\n")
	sb.WriteString("    \"task_title\": \"exact task title from list\",\n")
	sb.WriteString("    \"detected_status\": \"completed|in_progress|blocked|not_started\",\n")
	sb.WriteString("    \"confidence\": 0.85,\n")
	sb.WriteString("    \"evidence\": [\"relevant quote from message\"]\n")
	sb.WriteString("  }\n")
	sb.WriteString("]\n")
	sb.WriteString("```\n\n")
	sb.WriteString("Only include tasks that have some evidence in the messages. Output ONLY the JSON array, no other text.")

	return sb.String()
}

// parseAnalysisResponse parses the AI's response into structured data
func parseAnalysisResponse(response string, taskTitles []string) ([]TaskStatusAnalysis, error) {
	// Extract JSON from response (it might have markdown code blocks)
	jsonStr := response
	if idx := strings.Index(response, "["); idx != -1 {
		jsonStr = response[idx:]
	}
	if idx := strings.LastIndex(jsonStr, "]"); idx != -1 {
		jsonStr = jsonStr[:idx+1]
	}

	var analyses []TaskStatusAnalysis
	if err := json.Unmarshal([]byte(jsonStr), &analyses); err != nil {
		// If JSON parsing fails, return empty results with low confidence
		results := make([]TaskStatusAnalysis, 0, len(taskTitles))
		for _, title := range taskTitles {
			results = append(results, TaskStatusAnalysis{
				TaskTitle:      title,
				DetectedStatus: "unknown",
				Confidence:     0.0,
				Evidence:       []string{"Unable to analyze"},
			})
		}
		return results, nil
	}

	return analyses, nil
}

// CompareStatuses compares AI-detected statuses with actual Asana statuses
func CompareStatuses(analyses []TaskStatusAnalysis, asanaStatuses map[string]string) []StatusDiscrepancy {
	var discrepancies []StatusDiscrepancy

	for _, analysis := range analyses {
		asanaStatus, exists := asanaStatuses[analysis.TaskTitle]
		if !exists {
			continue
		}

		// Map detected status to comparable format
		detectedNormalized := normalizeStatus(analysis.DetectedStatus)
		asanaNormalized := normalizeStatus(asanaStatus)

		if detectedNormalized != asanaNormalized && analysis.Confidence >= 0.7 {
			discrepancies = append(discrepancies, StatusDiscrepancy{
				TaskTitle:       analysis.TaskTitle,
				SlackStatus:     analysis.DetectedStatus,
				AsanaStatus:     asanaStatus,
				Confidence:      analysis.Confidence,
				Evidence:        analysis.Evidence,
				RecommendAction: getRecommendedAction(analysis.DetectedStatus, asanaStatus),
			})
		}
	}

	return discrepancies
}

// StatusDiscrepancy represents a mismatch between Slack and Asana status
type StatusDiscrepancy struct {
	TaskTitle       string   `json:"task_title"`
	SlackStatus     string   `json:"slack_status"`
	AsanaStatus     string   `json:"asana_status"`
	Confidence      float64  `json:"confidence"`
	Evidence        []string `json:"evidence"`
	RecommendAction string   `json:"recommend_action"`
}

// normalizeStatus converts various status strings to a common format
func normalizeStatus(status string) string {
	status = strings.ToLower(status)
	switch status {
	case "completed", "done", "closed", "resolved":
		return "done"
	case "in_progress", "in progress", "working", "doing":
		return "in_progress"
	case "blocked", "stuck", "waiting":
		return "blocked"
	case "todo", "not_started", "new", "open":
		return "todo"
	default:
		return status
	}
}

// getRecommendedAction suggests what to do about a discrepancy
func getRecommendedAction(slackStatus, asanaStatus string) string {
	slackNorm := normalizeStatus(slackStatus)
	asanaNorm := normalizeStatus(asanaStatus)

	if slackNorm == "done" && asanaNorm != "done" {
		return "Consider marking task as complete in Asana"
	}
	if slackNorm != "done" && asanaNorm == "done" {
		return "Task may have been reopened - verify status"
	}
	if slackNorm == "blocked" {
		return "Review blockers and update task status"
	}

	return "Review and reconcile status difference"
}
