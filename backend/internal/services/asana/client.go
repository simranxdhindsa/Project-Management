package asana

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	BaseURL = "https://app.asana.com/api/1.0"
)

// Client is the Asana API client
type Client struct {
	accessToken string
	httpClient  *http.Client
}

// NewClient creates a new Asana API client
func NewClient(accessToken string) *Client {
	return &Client{
		accessToken: accessToken,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Task represents an Asana task
type Task struct {
	GID          string       `json:"gid"`
	Name         string       `json:"name"`
	Notes        string       `json:"notes"`
	Completed    bool         `json:"completed"`
	CompletedAt  *time.Time   `json:"completed_at,omitempty"`
	DueOn        *string      `json:"due_on,omitempty"`
	Assignee     *User        `json:"assignee,omitempty"`
	Projects     []Project    `json:"projects,omitempty"`
	Memberships  []Membership `json:"memberships,omitempty"`
	CreatedAt    time.Time    `json:"created_at"`
	ModifiedAt   time.Time    `json:"modified_at"`
	PermalinkURL string       `json:"permalink_url"`
}

// User represents an Asana user
type User struct {
	GID   string `json:"gid"`
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
}

// Project represents an Asana project
type Project struct {
	GID  string `json:"gid"`
	Name string `json:"name"`
}

// Workspace represents an Asana workspace
type Workspace struct {
	GID  string `json:"gid"`
	Name string `json:"name"`
}

// Section represents an Asana section (column)
type Section struct {
	GID  string `json:"gid"`
	Name string `json:"name"`
}

// Membership represents a task's membership in a project/section
type Membership struct {
	Project Project  `json:"project"`
	Section *Section `json:"section,omitempty"`
}

// Response wraps Asana API responses
type Response struct {
	Data   json.RawMessage `json:"data"`
	Errors []APIError      `json:"errors,omitempty"`
}

// ListResponse wraps paginated Asana API responses
type ListResponse struct {
	Data     json.RawMessage `json:"data"`
	NextPage *NextPage       `json:"next_page,omitempty"`
	Errors   []APIError      `json:"errors,omitempty"`
}

// NextPage contains pagination info
type NextPage struct {
	Offset string `json:"offset"`
	Path   string `json:"path"`
	URI    string `json:"uri"`
}

// APIError represents an Asana API error
type APIError struct {
	Message string `json:"message"`
	Help    string `json:"help,omitempty"`
}

// doRequest performs an HTTP request to the Asana API
func (c *Client) doRequest(ctx context.Context, method, path string, body interface{}) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(map[string]interface{}{"data": body})
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, BaseURL+path, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.accessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

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
		var errResp Response
		if err := json.Unmarshal(respBody, &errResp); err == nil && len(errResp.Errors) > 0 {
			return nil, fmt.Errorf("asana API error: %s", errResp.Errors[0].Message)
		}
		return nil, fmt.Errorf("asana API error: status %d", resp.StatusCode)
	}

	return respBody, nil
}

// GetMe returns the current user
func (c *Client) GetMe(ctx context.Context) (*User, error) {
	body, err := c.doRequest(ctx, http.MethodGet, "/users/me", nil)
	if err != nil {
		return nil, err
	}

	var resp Response
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	var user User
	if err := json.Unmarshal(resp.Data, &user); err != nil {
		return nil, fmt.Errorf("failed to unmarshal user: %w", err)
	}

	return &user, nil
}

// GetWorkspaces returns user's workspaces
func (c *Client) GetWorkspaces(ctx context.Context) ([]Workspace, error) {
	body, err := c.doRequest(ctx, http.MethodGet, "/workspaces", nil)
	if err != nil {
		return nil, err
	}

	var resp ListResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	var workspaces []Workspace
	if err := json.Unmarshal(resp.Data, &workspaces); err != nil {
		return nil, fmt.Errorf("failed to unmarshal workspaces: %w", err)
	}

	return workspaces, nil
}

// GetProjects returns projects in a workspace
func (c *Client) GetProjects(ctx context.Context, workspaceGID string) ([]Project, error) {
	path := fmt.Sprintf("/workspaces/%s/projects", workspaceGID)
	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}

	var resp ListResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	var projects []Project
	if err := json.Unmarshal(resp.Data, &projects); err != nil {
		return nil, fmt.Errorf("failed to unmarshal projects: %w", err)
	}

	return projects, nil
}

// GetSections returns sections in a project
func (c *Client) GetSections(ctx context.Context, projectGID string) ([]Section, error) {
	path := fmt.Sprintf("/projects/%s/sections", projectGID)
	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}

	var resp ListResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	var sections []Section
	if err := json.Unmarshal(resp.Data, &sections); err != nil {
		return nil, fmt.Errorf("failed to unmarshal sections: %w", err)
	}

	return sections, nil
}

// GetProjectTasks returns tasks in a project
func (c *Client) GetProjectTasks(ctx context.Context, projectGID string) ([]Task, error) {
	path := fmt.Sprintf("/projects/%s/tasks?opt_fields=gid,name,notes,completed,completed_at,due_on,assignee,assignee.name,assignee.email,memberships,memberships.project,memberships.section,created_at,modified_at,permalink_url", projectGID)
	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}

	var resp ListResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	var tasks []Task
	if err := json.Unmarshal(resp.Data, &tasks); err != nil {
		return nil, fmt.Errorf("failed to unmarshal tasks: %w", err)
	}

	return tasks, nil
}

// GetTask returns a single task by GID
func (c *Client) GetTask(ctx context.Context, taskGID string) (*Task, error) {
	path := fmt.Sprintf("/tasks/%s?opt_fields=gid,name,notes,completed,completed_at,due_on,assignee,assignee.name,assignee.email,memberships,memberships.project,memberships.section,created_at,modified_at,permalink_url", taskGID)
	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}

	var resp Response
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	var task Task
	if err := json.Unmarshal(resp.Data, &task); err != nil {
		return nil, fmt.Errorf("failed to unmarshal task: %w", err)
	}

	return &task, nil
}

// CreateTaskRequest contains the fields for creating a task
type CreateTaskRequest struct {
	Name      string  `json:"name"`
	Notes     string  `json:"notes,omitempty"`
	Projects  []string `json:"projects,omitempty"`
	Assignee  string  `json:"assignee,omitempty"`
	DueOn     string  `json:"due_on,omitempty"`
	Completed bool    `json:"completed,omitempty"`
}

// CreateTask creates a new task in Asana
func (c *Client) CreateTask(ctx context.Context, req CreateTaskRequest) (*Task, error) {
	body, err := c.doRequest(ctx, http.MethodPost, "/tasks", req)
	if err != nil {
		return nil, err
	}

	var resp Response
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	var task Task
	if err := json.Unmarshal(resp.Data, &task); err != nil {
		return nil, fmt.Errorf("failed to unmarshal task: %w", err)
	}

	return &task, nil
}

// UpdateTaskRequest contains the fields for updating a task
type UpdateTaskRequest struct {
	Name      *string `json:"name,omitempty"`
	Notes     *string `json:"notes,omitempty"`
	Completed *bool   `json:"completed,omitempty"`
	DueOn     *string `json:"due_on,omitempty"`
	Assignee  *string `json:"assignee,omitempty"`
}

// UpdateTask updates an existing task in Asana
func (c *Client) UpdateTask(ctx context.Context, taskGID string, req UpdateTaskRequest) (*Task, error) {
	path := fmt.Sprintf("/tasks/%s", taskGID)
	body, err := c.doRequest(ctx, http.MethodPut, path, req)
	if err != nil {
		return nil, err
	}

	var resp Response
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	var task Task
	if err := json.Unmarshal(resp.Data, &task); err != nil {
		return nil, fmt.Errorf("failed to unmarshal task: %w", err)
	}

	return &task, nil
}

// AddTaskToSection moves a task to a section
func (c *Client) AddTaskToSection(ctx context.Context, sectionGID, taskGID string) error {
	path := fmt.Sprintf("/sections/%s/addTask", sectionGID)
	_, err := c.doRequest(ctx, http.MethodPost, path, map[string]string{"task": taskGID})
	return err
}

// DeleteTask deletes a task from Asana
func (c *Client) DeleteTask(ctx context.Context, taskGID string) error {
	path := fmt.Sprintf("/tasks/%s", taskGID)
	_, err := c.doRequest(ctx, http.MethodDelete, path, nil)
	return err
}

// GetWorkspaceUsers returns all users in a workspace
func (c *Client) GetWorkspaceUsers(ctx context.Context, workspaceGID string) ([]User, error) {
	path := fmt.Sprintf("/workspaces/%s/users?opt_fields=gid,name,email", workspaceGID)
	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	var resp ListResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}
	var users []User
	if err := json.Unmarshal(resp.Data, &users); err != nil {
		return nil, fmt.Errorf("failed to unmarshal users: %w", err)
	}
	return users, nil
}

// Story represents an Asana task story (comment/activity)
type Story struct {
	GID       string `json:"gid"`
	Text      string `json:"text"`
	Type      string `json:"type"`
	CreatedAt string `json:"created_at"`
}

// GetTaskStories returns all stories (comments + activity) for a task
func (c *Client) GetTaskStories(ctx context.Context, taskGID string) ([]Story, error) {
	path := fmt.Sprintf("/tasks/%s/stories?opt_fields=gid,text,type,created_at", taskGID)
	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	var resp ListResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}
	var stories []Story
	if err := json.Unmarshal(resp.Data, &stories); err != nil {
		return nil, fmt.Errorf("failed to unmarshal stories: %w", err)
	}
	return stories, nil
}

// GetProjectTasksPaginated fetches all tasks from a project with pagination support (handles >100 tasks)
func (c *Client) GetProjectTasksPaginated(ctx context.Context, projectGID string) ([]Task, error) {
	fields := "gid,name,notes,completed,completed_at,due_on,assignee,assignee.name,assignee.email,memberships,memberships.project,memberships.section,memberships.section.name,created_at,modified_at,permalink_url,custom_fields,custom_fields.name,custom_fields.display_value,custom_fields.enum_value"
	baseURL := fmt.Sprintf("/projects/%s/tasks?opt_fields=%s&limit=100", projectGID, fields)

	var allTasks []Task
	nextURL := baseURL
	maxPages := 50

	for page := 0; page < maxPages && nextURL != ""; page++ {
		body, err := c.doRequest(ctx, http.MethodGet, nextURL, nil)
		if err != nil {
			return allTasks, err
		}
		var resp ListResponse
		if err := json.Unmarshal(body, &resp); err != nil {
			return allTasks, fmt.Errorf("failed to unmarshal response: %w", err)
		}
		var tasks []Task
		if err := json.Unmarshal(resp.Data, &tasks); err != nil {
			return allTasks, fmt.Errorf("failed to unmarshal tasks: %w", err)
		}
		allTasks = append(allTasks, tasks...)

		if resp.NextPage != nil && resp.NextPage.URI != "" {
			uri := resp.NextPage.URI
			// Convert relative URI to path only (strip https://app.asana.com/api/1.0)
			if len(uri) > len(BaseURL) && uri[:len(BaseURL)] == BaseURL {
				nextURL = uri[len(BaseURL):]
			} else {
				nextURL = uri
			}
		} else {
			nextURL = ""
		}
	}
	return allTasks, nil
}
