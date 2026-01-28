package asana

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/models"
)

// WebhookService handles Asana webhook events
type WebhookService struct {
	taskRepo        *database.TaskRepository
	projectRepo     *database.ProjectRepository
	integrationRepo *database.IntegrationRepository
	notificationRepo *database.NotificationRepository
}

// NewWebhookService creates a new webhook service
func NewWebhookService() *WebhookService {
	return &WebhookService{
		taskRepo:         database.NewTaskRepository(),
		projectRepo:      database.NewProjectRepository(),
		integrationRepo:  database.NewIntegrationRepository(),
		notificationRepo: database.NewNotificationRepository(),
	}
}

// WebhookEvent represents an Asana webhook event
type WebhookEvent struct {
	User     *WebhookUser     `json:"user,omitempty"`
	Resource *WebhookResource `json:"resource,omitempty"`
	Parent   *WebhookParent   `json:"parent,omitempty"`
	Action   string           `json:"action"`
	Type     string           `json:"type"`
}

// WebhookUser is the user who triggered the event
type WebhookUser struct {
	GID  string `json:"gid"`
	Name string `json:"name"`
}

// WebhookResource is the resource that was affected
type WebhookResource struct {
	GID          string `json:"gid"`
	ResourceType string `json:"resource_type"`
	Name         string `json:"name,omitempty"`
}

// WebhookParent is the parent of the resource
type WebhookParent struct {
	GID          string `json:"gid"`
	ResourceType string `json:"resource_type"`
	Name         string `json:"name,omitempty"`
}

// WebhookPayload is the full webhook payload
type WebhookPayload struct {
	Events []WebhookEvent `json:"events"`
}

// CreateWebhook creates a new webhook for an Asana project
func (c *Client) CreateWebhook(ctx context.Context, projectGID, callbackURL, secret string) (string, error) {
	body := map[string]interface{}{
		"resource": projectGID,
		"target":   callbackURL,
		"filters": []map[string]interface{}{
			{
				"resource_type": "task",
				"action":        "changed",
			},
			{
				"resource_type": "task",
				"action":        "added",
			},
			{
				"resource_type": "task",
				"action":        "removed",
			},
		},
	}

	respBody, err := c.doRequest(ctx, http.MethodPost, "/webhooks", body)
	if err != nil {
		return "", err
	}

	var resp struct {
		Data struct {
			GID string `json:"gid"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return "", fmt.Errorf("failed to unmarshal webhook response: %w", err)
	}

	return resp.Data.GID, nil
}

// DeleteWebhook removes a webhook
func (c *Client) DeleteWebhook(ctx context.Context, webhookGID string) error {
	path := fmt.Sprintf("/webhooks/%s", webhookGID)
	_, err := c.doRequest(ctx, http.MethodDelete, path, nil)
	return err
}

// ListWebhooks lists all webhooks for a workspace
func (c *Client) ListWebhooks(ctx context.Context, workspaceGID string) ([]WebhookInfo, error) {
	path := fmt.Sprintf("/webhooks?workspace=%s", workspaceGID)
	body, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data []WebhookInfo `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal webhooks: %w", err)
	}

	return resp.Data, nil
}

// WebhookInfo contains webhook details
type WebhookInfo struct {
	GID      string `json:"gid"`
	Resource struct {
		GID  string `json:"gid"`
		Name string `json:"name"`
	} `json:"resource"`
	Target string `json:"target"`
	Active bool   `json:"active"`
}

// VerifyWebhookSignature verifies the webhook signature
func VerifyWebhookSignature(body []byte, signature, secret string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expectedSignature := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(signature), []byte(expectedSignature))
}

// HandleWebhook processes incoming webhook events
func (s *WebhookService) HandleWebhook(ctx context.Context, events []WebhookEvent) error {
	for _, event := range events {
		if event.Resource == nil {
			continue
		}

		switch event.Resource.ResourceType {
		case "task":
			if err := s.handleTaskEvent(ctx, event); err != nil {
				log.Printf("Error handling task event: %v", err)
			}
		}
	}
	return nil
}

// handleTaskEvent processes task-related webhook events
func (s *WebhookService) handleTaskEvent(ctx context.Context, event WebhookEvent) error {
	taskGID := event.Resource.GID

	switch event.Action {
	case "added":
		// A new task was added - we'll sync it on next full sync
		// or we can fetch it immediately
		log.Printf("New task added in Asana: %s", taskGID)
		return nil

	case "changed":
		// Task was modified - fetch latest and update local copy
		return s.syncTaskFromAsana(ctx, taskGID)

	case "removed":
		// Task was removed/deleted
		log.Printf("Task removed in Asana: %s", taskGID)
		// Optionally mark local task as deleted or archive it
		return nil

	default:
		log.Printf("Unknown task action: %s", event.Action)
		return nil
	}
}

// syncTaskFromAsana fetches a task from Asana and updates the local copy
func (s *WebhookService) syncTaskFromAsana(ctx context.Context, taskGID string) error {
	// Find the local task by Asana ID
	existingTask, err := s.taskRepo.GetByAsanaID(ctx, taskGID)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			// Task doesn't exist locally, skip
			return nil
		}
		return fmt.Errorf("failed to get task by Asana ID: %w", err)
	}

	// Get the project to find the user's integration
	project, err := s.projectRepo.GetByID(ctx, existingTask.ProjectID)
	if err != nil {
		return fmt.Errorf("failed to get project: %w", err)
	}

	// Get the integration for the project owner
	integration, err := s.integrationRepo.GetAsanaIntegration(ctx, project.OwnerID)
	if err != nil {
		return fmt.Errorf("failed to get integration: %w", err)
	}

	if !integration.Connected {
		return nil
	}

	// Fetch the task from Asana
	client := NewClient(integration.AccessToken)
	asanaTask, err := client.GetTask(ctx, taskGID)
	if err != nil {
		return fmt.Errorf("failed to get Asana task: %w", err)
	}

	// Update local task
	oldStatus := existingTask.Status
	existingTask.Title = asanaTask.Name
	existingTask.Description = asanaTask.Notes
	existingTask.Status = mapAsanaStatusToLocal(*asanaTask)

	if asanaTask.DueOn != nil {
		dueDate, _ := time.Parse("2006-01-02", *asanaTask.DueOn)
		existingTask.DueDate = &dueDate
	}

	if err := s.taskRepo.Update(ctx, existingTask); err != nil {
		return fmt.Errorf("failed to update task: %w", err)
	}

	// Create notification if status changed
	if oldStatus != existingTask.Status && existingTask.AssigneeID != nil {
		notification := &models.Notification{
			UserID:  *existingTask.AssigneeID,
			Type:    models.NotificationTaskUpdated,
			Title:   "Task Status Updated",
			Message: fmt.Sprintf("Task '%s' was updated from %s to %s in Asana", existingTask.Title, oldStatus, existingTask.Status),
			TaskID:  &existingTask.ID,
		}
		s.notificationRepo.Create(ctx, notification)
	}

	return nil
}

// SetupWebhook sets up a webhook for a project
func (s *WebhookService) SetupWebhook(ctx context.Context, userID, projectID, callbackURL string) (string, error) {
	// Get project
	project, err := s.projectRepo.GetByID(ctx, projectID)
	if err != nil {
		return "", fmt.Errorf("failed to get project: %w", err)
	}

	if project.AsanaProjectID == nil || *project.AsanaProjectID == "" {
		return "", fmt.Errorf("project is not linked to Asana")
	}

	// Get integration
	integration, err := s.integrationRepo.GetAsanaIntegration(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("failed to get integration: %w", err)
	}

	if !integration.Connected {
		return "", fmt.Errorf("asana not connected")
	}

	// Create webhook
	client := NewClient(integration.AccessToken)
	webhookGID, err := client.CreateWebhook(ctx, *project.AsanaProjectID, callbackURL, "")
	if err != nil {
		return "", fmt.Errorf("failed to create webhook: %w", err)
	}

	return webhookGID, nil
}
