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

// AIClient interface for different AI providers
type AIClient interface {
	AnalyzeMessages(ctx context.Context, messages []SlackMessageForAnalysis, taskTitles []string) ([]TaskStatusAnalysis, error)
}

// NewAIClient creates an AI client based on environment configuration
func NewAIClient() AIClient {
	provider := os.Getenv("AI_PROVIDER") // Options: "groq", "openai", "gemini"
	if provider == "" {
		provider = "groq" // Default to Groq (best free tier)
	}

	switch provider {
	case "groq":
		return NewGroqClient()
	case "openai":
		return NewOpenAIClient()
	case "gemini":
		return NewGeminiClient()
	default:
		return NewGroqClient()
	}
}

// GroqClient for Groq AI (free tier: 30 requests/minute, 14,400/day)
type GroqClient struct {
	apiKey     string
	httpClient *http.Client
}

// NewGroqClient creates a new Groq AI client
func NewGroqClient() *GroqClient {
	apiKey := os.Getenv("GROQ_API_KEY")
	return &GroqClient{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// OpenAIRequest represents an OpenAI-compatible API request
type OpenAIRequest struct {
	Model    string          `json:"model"`
	Messages []OpenAIMessage `json:"messages"`
	Stream   bool            `json:"stream"`
}

// OpenAIMessage represents a chat message
type OpenAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// OpenAIResponse represents the API response
type OpenAIResponse struct {
	Choices []struct {
		Message OpenAIMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

// AnalyzeMessages implements AIClient interface for Groq
func (c *GroqClient) AnalyzeMessages(ctx context.Context, messages []SlackMessageForAnalysis, taskTitles []string) ([]TaskStatusAnalysis, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("GROQ_API_KEY environment variable not set. Get free API key from https://console.groq.com")
	}

	prompt := buildAnalysisPrompt(messages, taskTitles)

	req := OpenAIRequest{
		Model: "llama-3.3-70b-versatile", // Fast and accurate
		Messages: []OpenAIMessage{
			{
				Role:    "user",
				Content: prompt,
			},
		},
		Stream: false,
	}

	jsonBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.groq.com/openai/v1/chat/completions", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
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

	var openaiResp OpenAIResponse
	if err := json.Unmarshal(body, &openaiResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if openaiResp.Error != nil {
		return nil, fmt.Errorf("API error: %s", openaiResp.Error.Message)
	}

	if len(openaiResp.Choices) == 0 {
		return nil, fmt.Errorf("no response from AI")
	}

	responseText := openaiResp.Choices[0].Message.Content
	return parseAnalysisResponse(responseText, taskTitles)
}

// OpenAIClient for OpenAI API
type OpenAIClient struct {
	apiKey     string
	httpClient *http.Client
}

// NewOpenAIClient creates a new OpenAI client
func NewOpenAIClient() *OpenAIClient {
	apiKey := os.Getenv("OPENAI_API_KEY")
	return &OpenAIClient{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// AnalyzeMessages implements AIClient interface for OpenAI
func (c *OpenAIClient) AnalyzeMessages(ctx context.Context, messages []SlackMessageForAnalysis, taskTitles []string) ([]TaskStatusAnalysis, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("OPENAI_API_KEY environment variable not set")
	}

	prompt := buildAnalysisPrompt(messages, taskTitles)

	req := OpenAIRequest{
		Model: "gpt-4o-mini", // Cheaper model
		Messages: []OpenAIMessage{
			{
				Role:    "user",
				Content: prompt,
			},
		},
		Stream: false,
	}

	jsonBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.openai.com/v1/chat/completions", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
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

	var openaiResp OpenAIResponse
	if err := json.Unmarshal(body, &openaiResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if openaiResp.Error != nil {
		return nil, fmt.Errorf("API error: %s", openaiResp.Error.Message)
	}

	if len(openaiResp.Choices) == 0 {
		return nil, fmt.Errorf("no response from AI")
	}

	responseText := openaiResp.Choices[0].Message.Content
	return parseAnalysisResponse(responseText, taskTitles)
}

// buildAnalysisPrompt creates the prompt for AI analysis
func buildAnalysisPrompt(messages []SlackMessageForAnalysis, taskTitles []string) string {
	var sb strings.Builder

	sb.WriteString("You are an AI assistant that analyzes Slack messages to determine the status of tasks.\n\n")
	sb.WriteString("## Task List:\n")
	for i, title := range taskTitles {
		sb.WriteString(fmt.Sprintf("%d. %s\n", i+1, title))
	}

	sb.WriteString("\n## Slack Messages:\n")
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
