package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/dhindsa/tasksync-pro/internal/handlers"
	"github.com/dhindsa/tasksync-pro/internal/middleware"
	"github.com/dhindsa/tasksync-pro/internal/models"
	"github.com/gorilla/mux"
	"github.com/rs/cors"
)

// Response represents a standard API response
type Response struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

func main() {
	// Initialize router
	r := mux.NewRouter()

	// API routes
	api := r.PathPrefix("/api").Subrouter()

	// Health check (public)
	api.HandleFunc("/health", healthHandler).Methods("GET")

	// Auth routes (public)
	api.HandleFunc("/auth/google", handlers.HandleGoogleAuth).Methods("POST")
	api.HandleFunc("/auth/google/url", handlers.HandleGetAuthURL).Methods("GET")

	// Protected auth routes
	authProtected := api.PathPrefix("/auth").Subrouter()
	authProtected.Use(middleware.AuthMiddleware)
	authProtected.HandleFunc("/me", handlers.HandleGetMe).Methods("GET")
	authProtected.HandleFunc("/logout", handlers.HandleLogout).Methods("POST")
	authProtected.HandleFunc("/refresh", handlers.HandleRefreshToken).Methods("POST")

	// Task routes (protected)
	taskRoutes := api.PathPrefix("/tasks").Subrouter()
	taskRoutes.Use(middleware.AuthMiddleware)
	taskRoutes.HandleFunc("", getTasksHandler).Methods("GET")
	taskRoutes.HandleFunc("", createTaskHandler).Methods("POST")
	taskRoutes.HandleFunc("/yesterday-pending", getYesterdayPendingHandler).Methods("GET")
	taskRoutes.HandleFunc("/by-date/{date}", tasksByDateHandler).Methods("GET")
	taskRoutes.HandleFunc("/{id}", getTaskHandler).Methods("GET")
	taskRoutes.HandleFunc("/{id}/status", updateTaskStatusHandler).Methods("PATCH")

	// Asana routes (protected)
	asanaHandler := handlers.NewAsanaHandler()
	asanaRoutes := api.PathPrefix("/asana").Subrouter()
	asanaRoutes.Use(middleware.AuthMiddleware)
	asanaRoutes.HandleFunc("/connect", asanaHandler.ConnectAsana).Methods("POST")
	asanaRoutes.HandleFunc("/disconnect", asanaHandler.DisconnectAsana).Methods("POST")
	asanaRoutes.HandleFunc("/status", asanaHandler.GetAsanaStatus).Methods("GET")
	asanaRoutes.HandleFunc("/workspaces", asanaHandler.GetAsanaWorkspaces).Methods("GET")
	asanaRoutes.HandleFunc("/projects", asanaHandler.GetAsanaProjects).Methods("GET")
	asanaRoutes.HandleFunc("/projects/{asana_project_id}/sections", asanaHandler.GetAsanaSections).Methods("GET")

	// Project-specific Asana routes (protected)
	projectAsanaRoutes := api.PathPrefix("/projects/{id}/asana").Subrouter()
	projectAsanaRoutes.Use(middleware.AuthMiddleware)
	projectAsanaRoutes.HandleFunc("/link", asanaHandler.LinkProject).Methods("POST")
	projectAsanaRoutes.HandleFunc("/sync", asanaHandler.SyncProject).Methods("POST")
	projectAsanaRoutes.HandleFunc("/webhook", asanaHandler.SetupWebhook).Methods("POST")

	// Task-specific Asana routes (protected)
	taskAsanaRoutes := api.PathPrefix("/tasks/{id}/asana").Subrouter()
	taskAsanaRoutes.Use(middleware.AuthMiddleware)
	taskAsanaRoutes.HandleFunc("/sync", asanaHandler.SyncTaskStatus).Methods("POST")

	// Asana webhook endpoint (public - called by Asana)
	api.HandleFunc("/webhooks/asana", asanaHandler.HandleWebhook).Methods("POST")

	// Slack routes (protected)
	slackRoutes := api.PathPrefix("/slack").Subrouter()
	slackRoutes.Use(middleware.AuthMiddleware)
	slackRoutes.HandleFunc("/connect", slackConnectHandler).Methods("POST")
	slackRoutes.HandleFunc("/messages", slackMessagesHandler).Methods("GET")
	slackRoutes.HandleFunc("/analyze", slackAnalyzeHandler).Methods("POST")

	// Calendar routes (protected)
	calendarRoutes := api.PathPrefix("/calendar").Subrouter()
	calendarRoutes.Use(middleware.AuthMiddleware)
	calendarRoutes.HandleFunc("/{year}/{month}", calendarHandler).Methods("GET")

	// Notification routes (protected)
	notifRoutes := api.PathPrefix("/notifications").Subrouter()
	notifRoutes.Use(middleware.AuthMiddleware)
	notifRoutes.HandleFunc("", getNotificationsHandler).Methods("GET")
	notifRoutes.HandleFunc("/unread-count", getUnreadCountHandler).Methods("GET")
	notifRoutes.HandleFunc("/{id}/read", markNotificationReadHandler).Methods("PATCH")
	notifRoutes.HandleFunc("/read-all", markAllNotificationsReadHandler).Methods("PATCH")

	// Reports routes (protected - manager or above)
	reportRoutes := api.PathPrefix("/reports").Subrouter()
	reportRoutes.Use(middleware.AuthMiddleware)
	reportRoutes.HandleFunc("/team-productivity", teamProductivityHandler).Methods("GET")
	reportRoutes.HandleFunc("/individual/{userId}", individualReportHandler).Methods("GET")
	reportRoutes.HandleFunc("/project-health", projectHealthHandler).Methods("GET")
	reportRoutes.HandleFunc("/slack-accuracy", slackAccuracyHandler).Methods("GET")
	reportRoutes.HandleFunc("/export", exportReportHandler).Methods("GET")

	// User management routes (protected - admin only)
	userRoutes := api.PathPrefix("/users").Subrouter()
	userRoutes.Use(middleware.AuthMiddleware)
	userRoutes.Use(middleware.AdminOnly)
	userRoutes.HandleFunc("", getUsersHandler).Methods("GET")
	userRoutes.HandleFunc("/invite", inviteUserHandler).Methods("POST")
	userRoutes.HandleFunc("/{id}/role", updateUserRoleHandler).Methods("PATCH")
	userRoutes.HandleFunc("/{id}", deleteUserHandler).Methods("DELETE")

	// CORS configuration
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"http://localhost:5173", "http://localhost:3000"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	})

	handler := c.Handler(r)

	// Get port from environment or default to 8080
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("🚀 TaskSync Pro API server starting on port %s", port)
	log.Printf("📍 Health check: http://localhost:%s/api/health", port)

	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal("Server failed to start:", err)
	}
}

// Health check handler
func healthHandler(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "TaskSync Pro API is running",
		Data: map[string]string{
			"version": "1.0.0",
			"status":  "healthy",
		},
	})
}

// Task handlers

func getTasksHandler(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)

	// Sample data for demo
	tasks := []map[string]interface{}{
		{
			"id":          "1",
			"title":       "Update API documentation",
			"description": "Add new endpoints and update examples",
			"status":      "todo",
			"priority":    "high",
			"assignee":    user.Email,
			"asana_id":    "12345",
			"asana_url":   "https://app.asana.com/0/project/12345",
		},
		{
			"id":          "2",
			"title":       "Implement Slack integration",
			"description": "Connect bot to read channel messages",
			"status":      "in_progress",
			"priority":    "high",
			"assignee":    user.Email,
		},
		{
			"id":          "3",
			"title":       "Asana sync feature",
			"description": "Two-way task synchronization",
			"status":      "review",
			"priority":    "medium",
			"assignee":    "team@example.com",
		},
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    tasks,
	})
}

func getYesterdayPendingHandler(w http.ResponseWriter, r *http.Request) {
	// Return tasks that were in progress or todo yesterday
	pendingTasks := []map[string]interface{}{
		{
			"id":          "1",
			"title":       "Update API documentation",
			"description": "Add new endpoints and update examples",
			"status":      "todo",
			"priority":    "high",
			"from_date":   "2024-01-25",
		},
		{
			"id":          "2",
			"title":       "Implement Slack integration",
			"description": "Connect bot to read channel messages",
			"status":      "in_progress",
			"priority":    "high",
			"from_date":   "2024-01-25",
		},
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Yesterday's pending tasks",
		Data:    pendingTasks,
	})
}

func createTaskHandler(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusCreated, Response{
		Success: true,
		Message: "Task created - to be implemented with Asana sync",
	})
}

func getTaskHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Get task " + vars["id"],
		Data: map[string]interface{}{
			"id":          vars["id"],
			"title":       "Sample Task",
			"description": "Task details here",
			"status":      "in_progress",
		},
	})
}

func updateTaskStatusHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)

	var body struct {
		Status string `json:"status"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Task " + vars["id"] + " status updated to " + body.Status,
	})
}

func tasksByDateHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Tasks for date " + vars["date"],
		Data:    []interface{}{},
	})
}

// NOTE: Asana handlers moved to internal/handlers/asana.go

// Slack handlers

func slackConnectHandler(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Slack bot connection - to be implemented",
	})
}

func slackMessagesHandler(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: []map[string]interface{}{
			{"user": "John", "text": "Done with the API docs", "timestamp": "2024-01-26T10:30:00Z"},
			{"user": "Sarah", "text": "Still working on Slack integration", "timestamp": "2024-01-26T14:15:00Z"},
		},
	})
}

func slackAnalyzeHandler(w http.ResponseWriter, r *http.Request) {
	// This will use Gemini AI to analyze messages
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "AI Analysis - to be implemented with Gemini",
		Data: map[string]interface{}{
			"analysis": []map[string]interface{}{
				{"task": "API docs", "status": "completed", "confidence": 0.95},
				{"task": "Slack integration", "status": "in_progress", "confidence": 0.88},
			},
		},
	})
}

// Calendar handlers

func calendarHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)

	// Return task summary per day for the month
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]interface{}{
			"year":  vars["year"],
			"month": vars["month"],
			"days": map[string]interface{}{
				"1":  map[string]string{"status": "green", "count": "3"},
				"2":  map[string]string{"status": "yellow", "count": "2"},
				"15": map[string]string{"status": "red", "count": "1"},
			},
		},
	})
}

// Notification handlers

func getNotificationsHandler(w http.ResponseWriter, r *http.Request) {
	notifications := []map[string]interface{}{
		{
			"id":      "n1",
			"type":    "task_assigned",
			"message": "New task assigned: Update API docs",
			"read":    false,
			"time":    "2024-01-26T10:00:00Z",
		},
		{
			"id":      "n2",
			"type":    "task_completed",
			"message": "Sarah completed: Database schema",
			"read":    true,
			"time":    "2024-01-25T16:30:00Z",
		},
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    notifications,
	})
}

func getUnreadCountHandler(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    map[string]int{"count": 3},
	})
}

func markNotificationReadHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Notification " + vars["id"] + " marked as read",
	})
}

func markAllNotificationsReadHandler(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "All notifications marked as read",
	})
}

// Report handlers

func teamProductivityHandler(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]interface{}{
			"period":          "last_7_days",
			"tasks_completed": 24,
			"tasks_created":   30,
			"completion_rate": 80,
			"daily_data": []map[string]interface{}{
				{"date": "2024-01-20", "completed": 3},
				{"date": "2024-01-21", "completed": 5},
				{"date": "2024-01-22", "completed": 4},
			},
		},
	})
}

func individualReportHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]interface{}{
			"user_id":         vars["userId"],
			"tasks_completed": 12,
			"tasks_assigned":  15,
			"completion_rate": 80,
		},
	})
}

func projectHealthHandler(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]interface{}{
			"overdue_tasks":  4,
			"blocked_tasks":  2,
			"on_track_tasks": 18,
			"health_score":   75,
		},
	})
}

func slackAccuracyHandler(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]interface{}{
			"match_rate":       85,
			"discrepancies":    3,
			"total_comparisons": 20,
		},
	})
}

func exportReportHandler(w http.ResponseWriter, r *http.Request) {
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "pdf"
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Export report as " + format + " - to be implemented",
	})
}

// User management handlers

func getUsersHandler(w http.ResponseWriter, r *http.Request) {
	users := []map[string]interface{}{
		{"id": "1", "email": "admin@apyhub.com", "name": "Admin", "role": models.RoleAdmin},
		{"id": "2", "email": "pm@apyhub.com", "name": "Project Manager", "role": models.RoleProjectManager},
		{"id": "3", "email": "dev@apyhub.com", "name": "Developer", "role": models.RoleMember},
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    users,
	})
}

func inviteUserHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string      `json:"email"`
		Role  models.Role `json:"role"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Invitation sent to " + body.Email,
	})
}

func updateUserRoleHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	var body struct {
		Role models.Role `json:"role"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "User " + vars["id"] + " role updated to " + string(body.Role),
	})
}

func deleteUserHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "User " + vars["id"] + " removed",
	})
}

// Helper function to send JSON response
func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
