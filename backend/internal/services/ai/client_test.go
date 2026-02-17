package ai

import (
	"testing"
)

// ============================================================
// Parse Analysis Response Tests
// ============================================================

func TestParseAnalysisResponse_ValidJSON(t *testing.T) {
	response := `[
		{
			"task_title": "Fix login bug",
			"detected_status": "completed",
			"confidence": 0.95,
			"evidence": ["Login bug was fixed and deployed"]
		},
		{
			"task_title": "Update docs",
			"detected_status": "in_progress",
			"confidence": 0.8,
			"evidence": ["Still working on documentation"]
		}
	]`

	tasks := []string{"Fix login bug", "Update docs"}
	result, err := parseAnalysisResponse(response, tasks)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if len(result) != 2 {
		t.Fatalf("Expected 2 results, got %d", len(result))
	}

	if result[0].TaskTitle != "Fix login bug" {
		t.Errorf("Expected task title 'Fix login bug', got %q", result[0].TaskTitle)
	}
	if result[0].DetectedStatus != "completed" {
		t.Errorf("Expected status 'completed', got %q", result[0].DetectedStatus)
	}
	if result[0].Confidence != 0.95 {
		t.Errorf("Expected confidence 0.95, got %f", result[0].Confidence)
	}
	if result[1].DetectedStatus != "in_progress" {
		t.Errorf("Expected status 'in_progress', got %q", result[1].DetectedStatus)
	}
}

func TestParseAnalysisResponse_WithMarkdownCodeBlocks(t *testing.T) {
	response := "```json\n[\n{\"task_title\": \"Fix bug\", \"detected_status\": \"completed\", \"confidence\": 0.9, \"evidence\": [\"done\"]}\n]\n```"

	tasks := []string{"Fix bug"}
	result, err := parseAnalysisResponse(response, tasks)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if len(result) != 1 {
		t.Fatalf("Expected 1 result, got %d", len(result))
	}
	if result[0].DetectedStatus != "completed" {
		t.Errorf("Expected 'completed', got %q", result[0].DetectedStatus)
	}
}

func TestParseAnalysisResponse_InvalidJSON(t *testing.T) {
	response := "This is not JSON at all"
	tasks := []string{"Task 1", "Task 2"}

	result, err := parseAnalysisResponse(response, tasks)
	if err != nil {
		t.Fatalf("Should not error, should return fallback: %v", err)
	}

	if len(result) != 2 {
		t.Fatalf("Expected 2 fallback results, got %d", len(result))
	}
	for _, r := range result {
		if r.DetectedStatus != "unknown" {
			t.Errorf("Expected fallback status 'unknown', got %q", r.DetectedStatus)
		}
		if r.Confidence != 0.0 {
			t.Errorf("Expected fallback confidence 0.0, got %f", r.Confidence)
		}
	}
}

// ============================================================
// Parse Full Analysis Response Tests
// ============================================================

func TestParseFullAnalysisResponse_ValidJSON(t *testing.T) {
	response := `{
		"person_breakdown": [
			{
				"name": "Alice",
				"assigned": ["Task 1", "Task 2"],
				"completed": ["Task 1"],
				"pending": ["Task 2"],
				"blocked": [],
				"in_progress": []
			}
		],
		"analysis": [
			{
				"task_title": "Task 1",
				"detected_status": "completed",
				"confidence": 0.95,
				"evidence": ["Task 1 is done"]
			}
		],
		"summary": {
			"total_tasks": 2,
			"completed": 1,
			"in_progress": 0,
			"pending": 1,
			"blocked": 0,
			"not_mentioned": 0
		}
	}`

	result, err := parseFullAnalysisResponse(response)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if len(result.PersonBreakdown) != 1 {
		t.Fatalf("Expected 1 person, got %d", len(result.PersonBreakdown))
	}
	if result.PersonBreakdown[0].Name != "Alice" {
		t.Errorf("Expected name 'Alice', got %q", result.PersonBreakdown[0].Name)
	}
	if len(result.PersonBreakdown[0].Completed) != 1 {
		t.Errorf("Expected 1 completed task, got %d", len(result.PersonBreakdown[0].Completed))
	}
	if result.Summary.TotalTasks != 2 {
		t.Errorf("Expected total_tasks 2, got %d", result.Summary.TotalTasks)
	}
	if result.Summary.Completed != 1 {
		t.Errorf("Expected completed 1, got %d", result.Summary.Completed)
	}
}

func TestParseFullAnalysisResponse_WithExtraText(t *testing.T) {
	response := `Here is the analysis:\n\n{"person_breakdown": [], "analysis": [], "summary": {"total_tasks": 0, "completed": 0, "in_progress": 0, "pending": 0, "blocked": 0, "not_mentioned": 0}}`

	result, err := parseFullAnalysisResponse(response)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if result.Summary.TotalTasks != 0 {
		t.Errorf("Expected total_tasks 0, got %d", result.Summary.TotalTasks)
	}
}

func TestParseFullAnalysisResponse_InvalidJSON(t *testing.T) {
	response := "This is not valid JSON"

	_, err := parseFullAnalysisResponse(response)
	if err == nil {
		t.Error("Expected error for invalid JSON, got nil")
	}
}

// ============================================================
// Build Analysis Prompt Tests
// ============================================================

func TestBuildAnalysisPrompt(t *testing.T) {
	messages := []SlackMessageForAnalysis{
		{ID: "1", UserName: "Alice", Text: "Completed the login fix", Timestamp: "10:00"},
	}
	tasks := []string{"Fix login bug", "Update docs"}

	prompt := buildAnalysisPrompt(messages, tasks)

	if prompt == "" {
		t.Error("Prompt should not be empty")
	}
	if !contains(prompt, "Fix login bug") {
		t.Error("Prompt should contain task title")
	}
	if !contains(prompt, "Alice") {
		t.Error("Prompt should contain user name")
	}
	if !contains(prompt, "Completed the login fix") {
		t.Error("Prompt should contain message text")
	}
	if !contains(prompt, "detected_status") {
		t.Error("Prompt should contain output format instructions")
	}
}

func TestBuildFullAnalysisPrompt(t *testing.T) {
	morning := "@Alice\nFix login bug\nUpdate docs"
	evening := "Task update @Alice\nDone:\nFix login bug"

	prompt := buildFullAnalysisPrompt(morning, evening)

	if prompt == "" {
		t.Error("Prompt should not be empty")
	}
	if !contains(prompt, "MORNING TASK ASSIGNMENTS") {
		t.Error("Prompt should contain morning section")
	}
	if !contains(prompt, "EVENING STATUS UPDATES") {
		t.Error("Prompt should contain evening section")
	}
	if !contains(prompt, "Fix login bug") {
		t.Error("Prompt should contain task text")
	}
	if !contains(prompt, "person_breakdown") {
		t.Error("Prompt should contain output format")
	}
}

// ============================================================
// AI Client Factory Tests
// ============================================================

func TestNewAIClient_DefaultsToGroq(t *testing.T) {
	// When AI_PROVIDER is not set, should default to Groq
	client := NewAIClient()
	if _, ok := client.(*GroqClient); !ok {
		t.Error("Default AI client should be GroqClient")
	}
}

func TestNewGroqClient(t *testing.T) {
	client := NewGroqClient()
	if client == nil {
		t.Error("NewGroqClient should not return nil")
	}
	if client.httpClient == nil {
		t.Error("HTTP client should not be nil")
	}
}

func TestNewOpenAIClient(t *testing.T) {
	client := NewOpenAIClient()
	if client == nil {
		t.Error("NewOpenAIClient should not return nil")
	}
}

// ============================================================
// Helper
// ============================================================

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstring(s, substr))
}

func containsSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
