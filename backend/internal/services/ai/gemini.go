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
	// Using gemini-1.5-flash for better free tier limits
	// You can also use: gemini-2.0-flash (but has lower free quotas)
	GeminiAPIURL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
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


// AnalyzeFullInput implements AIClient interface for Gemini
func (c *GeminiClient) AnalyzeFullInput(ctx context.Context, morningText, eveningText string) (*FullAnalysisResponse, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("GEMINI_API_KEY environment variable not set")
	}

	prompt := buildFullAnalysisPrompt(morningText, eveningText)

	req := GeminiRequest{
		Contents: []Content{
			{
				Parts: []Part{
					{Text: prompt},
				},
			},
		},
		GenerationConfig: &GenerationConfig{
			Temperature:     0.2,
			MaxOutputTokens: 4096,
		},
	}

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

	responseText := geminiResp.Candidates[0].Content.Parts[0].Text
	return parseFullAnalysisResponse(responseText)
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
