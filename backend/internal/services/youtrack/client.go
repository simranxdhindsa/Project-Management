package youtrack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client is the YouTrack API client
type Client struct {
	baseURL    string
	token      string
	projectID  string
	boardID    string
	httpClient *http.Client
}

// NewClient creates a new YouTrack API client
func NewClient(baseURL, token, projectID string) *Client {
	// Ensure baseURL doesn't have trailing slash
	baseURL = strings.TrimSuffix(baseURL, "/")

	return &Client{
		baseURL:   baseURL,
		token:     token,
		projectID: projectID,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// SetBoardID sets the agile board ID
func (c *Client) SetBoardID(boardID string) {
	c.boardID = boardID
}

// Issue represents a YouTrack issue
type Issue struct {
	ID           string        `json:"id"`           // e.g., "PM-123"
	Summary      string        `json:"summary"`      // Issue title
	Description  string        `json:"description"`  // Issue description
	Created      int64         `json:"created"`      // Unix timestamp ms
	Updated      int64         `json:"updated"`      // Unix timestamp ms
	CustomFields []CustomField `json:"customFields"` // State, Subsystem, Priority, etc.
	Attachments  []Attachment  `json:"attachments,omitempty"`
	Project      *Project      `json:"project,omitempty"`
}

// CustomField represents a YouTrack custom field
type CustomField struct {
	Name  string      `json:"name"`            // "State", "Subsystem", "Priority", "Assignee"
	Type  string      `json:"$type,omitempty"` // YouTrack entity type e.g. "StateIssueCustomField"
	Value interface{} `json:"value"`           // Can be string, map, or array
}

// Attachment represents a file attachment
type Attachment struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	MimeType  string `json:"mimeType"`
	URL       string `json:"url"`
	Extension string `json:"extension"`
}

// User represents a YouTrack user
type User struct {
	ID       string `json:"id"`
	Login    string `json:"login"`
	FullName string `json:"fullName"`
	Email    string `json:"email,omitempty"`
}

// Board represents an agile board
type Board struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// State represents a workflow state
type State struct {
	Name string `json:"name"` // "Open", "In Progress", "Done", etc.
}

// Project represents a YouTrack project
type Project struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ShortName string `json:"shortName"` // Project key like "PM"
	Archived  bool   `json:"archived,omitempty"`
}

// Column represents a kanban column from an agile board
type Column struct {
	Name        string   `json:"name"`
	FieldValues []string `json:"fieldValues"` // Status values mapped to this column
}

// doRequest performs an HTTP request to the YouTrack API
func (c *Client) doRequest(ctx context.Context, method, path string, body interface{}) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonBody)
	}

	fullURL := c.baseURL + path
	req, err := http.NewRequestWithContext(ctx, method, fullURL, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-cache")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode >= 400 {
		switch resp.StatusCode {
		case 401:
			return nil, fmt.Errorf("YouTrack authentication failed. Please check your token")
		case 403:
			return nil, fmt.Errorf("YouTrack access forbidden. Your token may not have sufficient permissions")
		case 404:
			return nil, fmt.Errorf("YouTrack resource not found")
		default:
			return nil, fmt.Errorf("YouTrack API error: status %d - %s", resp.StatusCode, string(respBody))
		}
	}

	return respBody, nil
}

// GetProjects returns all available projects
func (c *Client) GetProjects(ctx context.Context) ([]Project, error) {
	// Try multiple API endpoints for compatibility
	endpoints := []string{
		"/api/admin/projects?fields=id,name,shortName,archived&$top=50&archived=false",
		"/api/projects?fields=id,name,shortName,archived&$top=50",
		"/api/admin/projects?fields=shortName,name&$top=50",
		"/api/admin/projects",
	}

	var lastError error
	for _, endpoint := range endpoints {
		body, err := c.doRequest(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			lastError = err
			continue
		}

		var projects []Project
		if err := json.Unmarshal(body, &projects); err != nil {
			lastError = err
			continue
		}

		return projects, nil
	}

	return nil, fmt.Errorf("all YouTrack endpoints failed: %v", lastError)
}

// GetBoards returns all agile boards
func (c *Client) GetBoards(ctx context.Context) ([]Board, error) {
	path := "/api/agiles?$top=-1&fields=id,name,sprintsSettings(disableSprints),projects(id)"
	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}

	var rawBoards []map[string]interface{}
	if err := json.Unmarshal(body, &rawBoards); err != nil {
		return nil, fmt.Errorf("failed to unmarshal boards: %w", err)
	}

	var boards []Board
	for _, board := range rawBoards {
		id, _ := board["id"].(string)
		name, _ := board["name"].(string)
		if id != "" && name != "" {
			boards = append(boards, Board{ID: id, Name: name})
		}
	}

	return boards, nil
}

// GetBoardColumns returns columns (states) from an agile board
func (c *Client) GetBoardColumns(ctx context.Context, boardID string) ([]Column, error) {
	path := fmt.Sprintf("/api/agiles/%s?fields=columnSettings(columns(fieldValues(name,presentation)))", boardID)
	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}

	var agileBoard map[string]interface{}
	if err := json.Unmarshal(body, &agileBoard); err != nil {
		return nil, fmt.Errorf("failed to unmarshal board: %w", err)
	}

	var columns []Column
	if columnSettings, ok := agileBoard["columnSettings"].(map[string]interface{}); ok {
		if cols, ok := columnSettings["columns"].([]interface{}); ok {
			for _, col := range cols {
				if column, ok := col.(map[string]interface{}); ok {
					var fieldValues []string
					if fvs, ok := column["fieldValues"].([]interface{}); ok {
						for _, fv := range fvs {
							if fieldValue, ok := fv.(map[string]interface{}); ok {
								if name, ok := fieldValue["name"].(string); ok {
									fieldValues = append(fieldValues, name)
								} else if presentation, ok := fieldValue["presentation"].(string); ok {
									fieldValues = append(fieldValues, presentation)
								}
							}
						}
					}
					if len(fieldValues) > 0 {
						columns = append(columns, Column{
							Name:        fieldValues[0], // First value as column name
							FieldValues: fieldValues,
						})
					}
				}
			}
		}
	}

	return columns, nil
}

// GetStates returns workflow states for the project
func (c *Client) GetStates(ctx context.Context) ([]State, error) {
	path := fmt.Sprintf("/api/admin/projects/%s/customFields?fields=field(name,fieldType(id)),bundle(values(name))",
		c.projectID)

	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}

	var customFields []map[string]interface{}
	if err := json.Unmarshal(body, &customFields); err != nil {
		return nil, fmt.Errorf("failed to unmarshal custom fields: %w", err)
	}

	var states []State
	for _, field := range customFields {
		if fieldInfo, ok := field["field"].(map[string]interface{}); ok {
			if fieldName, ok := fieldInfo["name"].(string); ok && fieldName == "State" {
				if bundle, ok := field["bundle"].(map[string]interface{}); ok {
					if values, ok := bundle["values"].([]interface{}); ok {
						for _, val := range values {
							if valMap, ok := val.(map[string]interface{}); ok {
								if stateName, ok := valMap["name"].(string); ok {
									states = append(states, State{Name: stateName})
								}
							}
						}
					}
				}
			}
		}
	}

	// If no states found from custom fields, try board columns
	if len(states) == 0 && c.boardID != "" {
		columns, err := c.GetBoardColumns(ctx, c.boardID)
		if err == nil {
			seen := make(map[string]bool)
			for _, col := range columns {
				for _, fv := range col.FieldValues {
					if !seen[fv] {
						seen[fv] = true
						states = append(states, State{Name: fv})
					}
				}
			}
		}
	}

	return states, nil
}

// GetIssues returns all issues from the project
func (c *Client) GetIssues(ctx context.Context) ([]Issue, error) {
	query := url.QueryEscape(fmt.Sprintf("project: %s", c.projectID))
	fields := "id,summary,description,created,updated,customFields(name,value(name,presentation)),attachments(id,name,size,mimeType,url,extension),project(shortName)"
	path := fmt.Sprintf("/api/issues?fields=%s&query=%s&$top=200", fields, query)

	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}

	var issues []Issue
	if err := json.Unmarshal(body, &issues); err != nil {
		return nil, fmt.Errorf("failed to unmarshal issues: %w", err)
	}

	return issues, nil
}

// GetIssue returns a single issue by ID
func (c *Client) GetIssue(ctx context.Context, issueID string) (*Issue, error) {
	fields := "id,summary,description,created,updated,customFields(name,value(name,presentation)),attachments(id,name,size,mimeType,url,extension),project(shortName)"
	path := fmt.Sprintf("/api/issues/%s?fields=%s", issueID, fields)

	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}

	var issue Issue
	if err := json.Unmarshal(body, &issue); err != nil {
		return nil, fmt.Errorf("failed to unmarshal issue: %w", err)
	}

	return &issue, nil
}

// CreateIssueRequest contains the fields for creating an issue
type CreateIssueRequest struct {
	Summary      string        `json:"summary"`
	Description  string        `json:"description,omitempty"`
	Project      ProjectRef    `json:"project"`
	CustomFields []CustomField `json:"customFields,omitempty"`
}

// ProjectRef is a reference to a project by ID
type ProjectRef struct {
	ID string `json:"id"`
}

// CreateIssue creates a new issue in YouTrack
func (c *Client) CreateIssue(ctx context.Context, req CreateIssueRequest) (*Issue, error) {
	// Set project ID if not provided
	if req.Project.ID == "" {
		req.Project.ID = c.projectID
	}

	path := "/api/issues?fields=id,summary,description,created,updated,customFields(name,value(name,presentation)),project(shortName)"
	body, err := c.doRequest(ctx, http.MethodPost, path, req)
	if err != nil {
		return nil, err
	}

	var issue Issue
	if err := json.Unmarshal(body, &issue); err != nil {
		return nil, fmt.Errorf("failed to unmarshal created issue: %w", err)
	}

	return &issue, nil
}

// UpdateIssueRequest contains the fields for updating an issue
type UpdateIssueRequest struct {
	Summary      string        `json:"summary,omitempty"`
	Description  string        `json:"description,omitempty"`
	CustomFields []CustomField `json:"customFields,omitempty"`
}

// UpdateIssue updates an existing issue
func (c *Client) UpdateIssue(ctx context.Context, issueID string, req UpdateIssueRequest) (*Issue, error) {
	path := fmt.Sprintf("/api/issues/%s?fields=id,summary,description,created,updated,customFields(name,value(name,presentation)),project(shortName)", issueID)
	body, err := c.doRequest(ctx, http.MethodPost, path, req)
	if err != nil {
		return nil, err
	}

	var issue Issue
	if err := json.Unmarshal(body, &issue); err != nil {
		return nil, fmt.Errorf("failed to unmarshal updated issue: %w", err)
	}

	return &issue, nil
}

// DeleteIssue deletes an issue from YouTrack
func (c *Client) DeleteIssue(ctx context.Context, issueID string) error {
	path := fmt.Sprintf("/api/issues/%s", issueID)
	_, err := c.doRequest(ctx, http.MethodDelete, path, nil)
	return err
}

// GetUsers returns all YouTrack users
func (c *Client) GetUsers(ctx context.Context) ([]User, error) {
	path := "/api/users?fields=id,login,fullName,email"
	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}

	var users []User
	if err := json.Unmarshal(body, &users); err != nil {
		return nil, fmt.Errorf("failed to unmarshal users: %w", err)
	}

	return users, nil
}

// AssignToBoard assigns an issue to an agile board
func (c *Client) AssignToBoard(ctx context.Context, issueID, boardName string) error {
	commandReq := map[string]interface{}{
		"issues": []map[string]string{{"id": issueID}},
		"query":  fmt.Sprintf("add Board %s", boardName),
	}

	_, err := c.doRequest(ctx, http.MethodPost, "/api/commands", commandReq)
	return err
}

// UpdateIssueState updates the state of an issue
func (c *Client) UpdateIssueState(ctx context.Context, issueID, newState string) error {
	req := UpdateIssueRequest{
		CustomFields: []CustomField{
			{
				Name:  "State",
				Type:  "StateIssueCustomField",
				Value: map[string]string{
					"name":  newState,
					"$type": "StateBundleElement",
				},
			},
		},
	}

	_, err := c.UpdateIssue(ctx, issueID, req)
	return err
}

// GetStatus extracts the status/state from an issue's custom fields
func GetStatus(issue Issue) string {
	for _, field := range issue.CustomFields {
		if field.Name == "State" {
			if valueMap, ok := field.Value.(map[string]interface{}); ok {
				if name, ok := valueMap["name"].(string); ok {
					return name
				}
				if presentation, ok := valueMap["presentation"].(string); ok {
					return presentation
				}
			}
			if str, ok := field.Value.(string); ok {
				return str
			}
		}
	}
	return "Unknown"
}

// GetSubsystem extracts the subsystem from an issue's custom fields
func GetSubsystem(issue Issue) string {
	for _, field := range issue.CustomFields {
		if field.Name == "Subsystem" {
			if valueMap, ok := field.Value.(map[string]interface{}); ok {
				if name, ok := valueMap["name"].(string); ok {
					return name
				}
			}
			if str, ok := field.Value.(string); ok {
				return str
			}
		}
	}
	return ""
}

// GetAssignee extracts the assignee from an issue's custom fields
func GetAssignee(issue Issue) *User {
	for _, field := range issue.CustomFields {
		if field.Name == "Assignee" {
			if valueMap, ok := field.Value.(map[string]interface{}); ok {
				user := &User{}
				if id, ok := valueMap["id"].(string); ok {
					user.ID = id
				}
				if login, ok := valueMap["login"].(string); ok {
					user.Login = login
				}
				if fullName, ok := valueMap["fullName"].(string); ok {
					user.FullName = fullName
				}
				if email, ok := valueMap["email"].(string); ok {
					user.Email = email
				}
				return user
			}
		}
	}
	return nil
}

// GetPriority extracts the priority from an issue's custom fields
func GetPriority(issue Issue) string {
	for _, field := range issue.CustomFields {
		if field.Name == "Priority" {
			if valueMap, ok := field.Value.(map[string]interface{}); ok {
				if name, ok := valueMap["name"].(string); ok {
					return name
				}
			}
			if str, ok := field.Value.(string); ok {
				return str
			}
		}
	}
	return "Normal"
}

// TestConnection tests the connection to YouTrack
func (c *Client) TestConnection(ctx context.Context) error {
	_, err := c.GetProjects(ctx)
	return err
}

// IsDuplicateIssue checks if an issue with the same summary already exists
func (c *Client) IsDuplicateIssue(ctx context.Context, summary string) (bool, error) {
	issues, err := c.GetIssues(ctx)
	if err != nil {
		return false, err
	}

	normalizedSummary := strings.ToLower(strings.TrimSpace(summary))
	for _, issue := range issues {
		if strings.ToLower(strings.TrimSpace(issue.Summary)) == normalizedSummary {
			return true, nil
		}
	}

	return false, nil
}
