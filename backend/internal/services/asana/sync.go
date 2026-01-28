package asana

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/models"
)

// SyncService handles two-way synchronization with Asana
type SyncService struct {
	taskRepo        *database.TaskRepository
	projectRepo     *database.ProjectRepository
	integrationRepo *database.IntegrationRepository
}

// NewSyncService creates a new Asana sync service
func NewSyncService() *SyncService {
	return &SyncService{
		taskRepo:        database.NewTaskRepository(),
		projectRepo:     database.NewProjectRepository(),
		integrationRepo: database.NewIntegrationRepository(),
	}
}

// SyncResult contains the result of a sync operation
type SyncResult struct {
	TasksSynced   int      `json:"tasks_synced"`
	TasksCreated  int      `json:"tasks_created"`
	TasksUpdated  int      `json:"tasks_updated"`
	Errors        []string `json:"errors,omitempty"`
}

// SyncProject performs a two-way sync for a project
func (s *SyncService) SyncProject(ctx context.Context, userID, projectID string) (*SyncResult, error) {
	// Get the Asana integration for this user
	integration, err := s.integrationRepo.GetAsanaIntegration(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get Asana integration: %w", err)
	}

	if !integration.Connected {
		return nil, fmt.Errorf("asana integration is not connected")
	}

	// Get the local project
	project, err := s.projectRepo.GetByID(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to get project: %w", err)
	}

	if project.AsanaProjectID == nil || *project.AsanaProjectID == "" {
		return nil, fmt.Errorf("project is not linked to an Asana project")
	}

	client := NewClient(integration.AccessToken)
	result := &SyncResult{}

	// Pull tasks from Asana
	pullResult, err := s.pullFromAsana(ctx, client, project, userID)
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("pull error: %v", err))
	} else {
		result.TasksCreated += pullResult.TasksCreated
		result.TasksUpdated += pullResult.TasksUpdated
		result.TasksSynced += pullResult.TasksSynced
	}

	// Push local tasks to Asana
	pushResult, err := s.pushToAsana(ctx, client, project, userID)
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("push error: %v", err))
	} else {
		result.TasksCreated += pushResult.TasksCreated
		result.TasksUpdated += pushResult.TasksUpdated
		result.TasksSynced += pushResult.TasksSynced
	}

	// Update last sync time
	s.integrationRepo.UpdateAsanaLastSync(ctx, userID)

	return result, nil
}

// pullFromAsana fetches tasks from Asana and updates local database
func (s *SyncService) pullFromAsana(ctx context.Context, client *Client, project *models.Project, userID string) (*SyncResult, error) {
	result := &SyncResult{}

	// Get tasks from Asana
	asanaTasks, err := client.GetProjectTasks(ctx, *project.AsanaProjectID)
	if err != nil {
		return nil, fmt.Errorf("failed to get Asana tasks: %w", err)
	}

	for _, asanaTask := range asanaTasks {
		// Check if task already exists locally
		existingTask, err := s.taskRepo.GetByAsanaID(ctx, asanaTask.GID)
		if err != nil && !strings.Contains(err.Error(), "no rows") {
			result.Errors = append(result.Errors, fmt.Sprintf("error checking task %s: %v", asanaTask.GID, err))
			continue
		}

		status := mapAsanaStatusToLocal(asanaTask)

		if existingTask != nil {
			// Update existing task
			existingTask.Title = asanaTask.Name
			existingTask.Description = asanaTask.Notes
			existingTask.Status = status
			if asanaTask.DueOn != nil {
				dueDate, _ := time.Parse("2006-01-02", *asanaTask.DueOn)
				existingTask.DueDate = &dueDate
			}

			if err := s.taskRepo.Update(ctx, existingTask); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("error updating task %s: %v", asanaTask.GID, err))
				continue
			}
			result.TasksUpdated++
		} else {
			// Create new task locally
			newTask := &models.Task{
				Title:       asanaTask.Name,
				Description: asanaTask.Notes,
				Status:      status,
				Priority:    models.TaskPriorityMedium,
				ProjectID:   project.ID,
				AsanaID:     &asanaTask.GID,
				AsanaURL:    &asanaTask.PermalinkURL,
				CreatedBy:   userID,
			}
			if asanaTask.DueOn != nil {
				dueDate, _ := time.Parse("2006-01-02", *asanaTask.DueOn)
				newTask.DueDate = &dueDate
			}

			if err := s.taskRepo.Create(ctx, newTask); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("error creating task %s: %v", asanaTask.GID, err))
				continue
			}
			result.TasksCreated++
		}
		result.TasksSynced++
	}

	return result, nil
}

// pushToAsana pushes local tasks to Asana
func (s *SyncService) pushToAsana(ctx context.Context, client *Client, project *models.Project, userID string) (*SyncResult, error) {
	result := &SyncResult{}

	// Get local tasks that don't have an Asana ID yet
	filter := &models.TaskFilter{ProjectID: &project.ID}
	localTasks, err := s.taskRepo.List(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("failed to get local tasks: %w", err)
	}

	for _, task := range localTasks {
		if task.AsanaID != nil && *task.AsanaID != "" {
			// Task already exists in Asana, update it
			completed := task.Status == models.TaskStatusDone
			updateReq := UpdateTaskRequest{
				Name:      &task.Title,
				Notes:     &task.Description,
				Completed: &completed,
			}
			if task.DueDate != nil {
				dueStr := task.DueDate.Format("2006-01-02")
				updateReq.DueOn = &dueStr
			}

			_, err := client.UpdateTask(ctx, *task.AsanaID, updateReq)
			if err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("error updating Asana task %s: %v", task.ID, err))
				continue
			}
			result.TasksUpdated++
		} else {
			// Create new task in Asana
			createReq := CreateTaskRequest{
				Name:      task.Title,
				Notes:     task.Description,
				Projects:  []string{*project.AsanaProjectID},
				Completed: task.Status == models.TaskStatusDone,
			}
			if task.DueDate != nil {
				createReq.DueOn = task.DueDate.Format("2006-01-02")
			}

			asanaTask, err := client.CreateTask(ctx, createReq)
			if err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("error creating Asana task for %s: %v", task.ID, err))
				continue
			}

			// Update local task with Asana ID
			if err := s.taskRepo.UpdateAsanaID(ctx, task.ID, asanaTask.GID, asanaTask.PermalinkURL); err != nil {
				log.Printf("Failed to update Asana ID for task %s: %v", task.ID, err)
			}
			result.TasksCreated++
		}
		result.TasksSynced++
	}

	return result, nil
}

// SyncTaskStatus syncs a single task's status change to Asana
func (s *SyncService) SyncTaskStatus(ctx context.Context, userID, taskID string, newStatus models.TaskStatus) error {
	// Get the Asana integration
	integration, err := s.integrationRepo.GetAsanaIntegration(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to get Asana integration: %w", err)
	}

	if !integration.Connected {
		return nil // Silently skip if not connected
	}

	// Get the task
	task, err := s.taskRepo.GetByID(ctx, taskID)
	if err != nil {
		return fmt.Errorf("failed to get task: %w", err)
	}

	if task.AsanaID == nil || *task.AsanaID == "" {
		return nil // Task not linked to Asana
	}

	client := NewClient(integration.AccessToken)

	// Update the task in Asana
	completed := newStatus == models.TaskStatusDone
	updateReq := UpdateTaskRequest{
		Completed: &completed,
	}

	_, err = client.UpdateTask(ctx, *task.AsanaID, updateReq)
	if err != nil {
		return fmt.Errorf("failed to update Asana task: %w", err)
	}

	return nil
}

// MoveTaskToSection moves a task to a specific section in Asana
func (s *SyncService) MoveTaskToSection(ctx context.Context, userID, taskID, sectionGID string) error {
	integration, err := s.integrationRepo.GetAsanaIntegration(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to get Asana integration: %w", err)
	}

	if !integration.Connected {
		return nil
	}

	task, err := s.taskRepo.GetByID(ctx, taskID)
	if err != nil {
		return fmt.Errorf("failed to get task: %w", err)
	}

	if task.AsanaID == nil || *task.AsanaID == "" {
		return nil
	}

	client := NewClient(integration.AccessToken)
	return client.AddTaskToSection(ctx, sectionGID, *task.AsanaID)
}

// mapAsanaStatusToLocal maps Asana task state to local status
func mapAsanaStatusToLocal(task Task) models.TaskStatus {
	if task.Completed {
		return models.TaskStatusDone
	}

	// Check section for more granular status
	for _, membership := range task.Memberships {
		if membership.Section != nil {
			sectionName := strings.ToLower(membership.Section.Name)
			switch {
			case strings.Contains(sectionName, "done") || strings.Contains(sectionName, "complete"):
				return models.TaskStatusDone
			case strings.Contains(sectionName, "progress") || strings.Contains(sectionName, "doing"):
				return models.TaskStatusInProgress
			case strings.Contains(sectionName, "review"):
				return models.TaskStatusReview
			case strings.Contains(sectionName, "todo") || strings.Contains(sectionName, "backlog"):
				return models.TaskStatusTodo
			}
		}
	}

	return models.TaskStatusTodo
}

// LinkProject links a local project to an Asana project
func (s *SyncService) LinkProject(ctx context.Context, userID, projectID, asanaProjectID string) error {
	integration, err := s.integrationRepo.GetAsanaIntegration(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to get Asana integration: %w", err)
	}

	if !integration.Connected {
		return fmt.Errorf("asana integration is not connected")
	}

	// Verify the Asana project exists
	client := NewClient(integration.AccessToken)
	projects, err := client.GetProjects(ctx, integration.WorkspaceID)
	if err != nil {
		return fmt.Errorf("failed to get Asana projects: %w", err)
	}

	found := false
	for _, p := range projects {
		if p.GID == asanaProjectID {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("asana project not found in workspace")
	}

	// Update local project with Asana project ID
	project, err := s.projectRepo.GetByID(ctx, projectID)
	if err != nil {
		return fmt.Errorf("failed to get project: %w", err)
	}

	project.AsanaProjectID = &asanaProjectID
	return s.projectRepo.Update(ctx, project)
}

// GetAsanaProjects returns available Asana projects
func (s *SyncService) GetAsanaProjects(ctx context.Context, userID string) ([]Project, error) {
	integration, err := s.integrationRepo.GetAsanaIntegration(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get Asana integration: %w", err)
	}

	if !integration.Connected {
		return nil, fmt.Errorf("asana integration is not connected")
	}

	client := NewClient(integration.AccessToken)
	return client.GetProjects(ctx, integration.WorkspaceID)
}

// GetAsanaSections returns sections for an Asana project
func (s *SyncService) GetAsanaSections(ctx context.Context, userID, asanaProjectID string) ([]Section, error) {
	integration, err := s.integrationRepo.GetAsanaIntegration(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get Asana integration: %w", err)
	}

	if !integration.Connected {
		return nil, fmt.Errorf("asana integration is not connected")
	}

	client := NewClient(integration.AccessToken)
	return client.GetSections(ctx, asanaProjectID)
}
