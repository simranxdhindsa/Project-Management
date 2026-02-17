package youtrack

import (
	"testing"
)

// ============================================================
// GetStatus Tests
// ============================================================

func TestGetStatus_StateField(t *testing.T) {
	issue := Issue{
		ID:      "PM-1",
		Summary: "Test issue",
		CustomFields: []CustomField{
			{
				Name:  "State",
				Type:  "StateIssueCustomField",
				Value: map[string]interface{}{"name": "In Progress"},
			},
		},
	}

	status := GetStatus(issue)
	if status != "In Progress" {
		t.Errorf("Expected 'In Progress', got %q", status)
	}
}

func TestGetStatus_StateWithPresentation(t *testing.T) {
	issue := Issue{
		ID:      "PM-2",
		Summary: "Test issue",
		CustomFields: []CustomField{
			{
				Name:  "State",
				Type:  "StateIssueCustomField",
				Value: map[string]interface{}{"presentation": "DEV"},
			},
		},
	}

	status := GetStatus(issue)
	if status != "DEV" {
		t.Errorf("Expected 'DEV', got %q", status)
	}
}

func TestGetStatus_NoStateField(t *testing.T) {
	issue := Issue{
		ID:           "PM-3",
		Summary:      "Test issue",
		CustomFields: []CustomField{},
	}

	status := GetStatus(issue)
	if status != "Unknown" {
		t.Errorf("Expected 'Unknown', got %q", status)
	}
}

func TestGetStatus_StringValue(t *testing.T) {
	issue := Issue{
		ID:      "PM-4",
		Summary: "Test issue",
		CustomFields: []CustomField{
			{
				Name:  "State",
				Value: "Open",
			},
		},
	}

	status := GetStatus(issue)
	if status != "Open" {
		t.Errorf("Expected 'Open', got %q", status)
	}
}

// ============================================================
// GetAssignee Tests
// ============================================================

func TestGetAssignee_WithAssignee(t *testing.T) {
	issue := Issue{
		ID:      "PM-5",
		Summary: "Test issue",
		CustomFields: []CustomField{
			{
				Name: "Assignee",
				Value: map[string]interface{}{
					"id":       "user-1",
					"login":    "alice",
					"fullName": "Alice Smith",
					"email":    "alice@example.com",
				},
			},
		},
	}

	user := GetAssignee(issue)
	if user == nil {
		t.Fatal("Expected user, got nil")
	}
	if user.FullName != "Alice Smith" {
		t.Errorf("Expected 'Alice Smith', got %q", user.FullName)
	}
	if user.Login != "alice" {
		t.Errorf("Expected 'alice', got %q", user.Login)
	}
	if user.Email != "alice@example.com" {
		t.Errorf("Expected 'alice@example.com', got %q", user.Email)
	}
}

func TestGetAssignee_NoAssigneeField(t *testing.T) {
	issue := Issue{
		ID:           "PM-6",
		Summary:      "Test issue",
		CustomFields: []CustomField{},
	}

	user := GetAssignee(issue)
	if user != nil {
		t.Errorf("Expected nil for unassigned issue, got %v", user)
	}
}

// ============================================================
// NewClient Tests
// ============================================================

func TestNewClient(t *testing.T) {
	client := NewClient("https://youtrack.example.com/", "token123", "PM")
	if client == nil {
		t.Fatal("Expected client, got nil")
	}
	if client.baseURL != "https://youtrack.example.com" {
		t.Errorf("Expected trailing slash removed, got %q", client.baseURL)
	}
	if client.token != "token123" {
		t.Errorf("Expected token 'token123', got %q", client.token)
	}
	if client.projectID != "PM" {
		t.Errorf("Expected projectID 'PM', got %q", client.projectID)
	}
}

func TestNewClient_NoTrailingSlash(t *testing.T) {
	client := NewClient("https://youtrack.example.com", "token", "PM")
	if client.baseURL != "https://youtrack.example.com" {
		t.Errorf("Expected no change, got %q", client.baseURL)
	}
}

// ============================================================
// Multiple CustomFields Tests
// ============================================================

func TestGetStatus_MultipleFields(t *testing.T) {
	issue := Issue{
		ID:      "PM-7",
		Summary: "Test issue",
		CustomFields: []CustomField{
			{Name: "Priority", Value: "Normal"},
			{Name: "Subsystem", Value: "Backend"},
			{Name: "State", Value: map[string]interface{}{"name": "Done"}},
			{Name: "Assignee", Value: map[string]interface{}{"fullName": "Bob"}},
		},
	}

	status := GetStatus(issue)
	if status != "Done" {
		t.Errorf("Expected 'Done', got %q", status)
	}

	user := GetAssignee(issue)
	if user == nil || user.FullName != "Bob" {
		t.Errorf("Expected Bob as assignee")
	}
}
