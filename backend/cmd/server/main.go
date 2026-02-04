package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/handlers"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/rs/cors"
)

func init() {
	// Load .env file before anything else
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}
}

// Response represents a standard API response
type Response struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

func main() {
	// Connect to database
	log.Println("📦 Connecting to database...")
	if err := database.Connect(); err != nil {
		log.Printf("⚠️  Database connection failed: %v", err)
		log.Println("⚠️  Running without database - using in-memory storage")
	} else {
		log.Println("✅ Database connected successfully")
		defer database.Close()
	}

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
	taskHandler := handlers.NewTaskHandler()
	taskRoutes := api.PathPrefix("/tasks").Subrouter()
	taskRoutes.Use(middleware.AuthMiddleware)
	taskRoutes.HandleFunc("", taskHandler.GetTasks).Methods("GET")
	taskRoutes.HandleFunc("", taskHandler.CreateTask).Methods("POST")
	taskRoutes.HandleFunc("/yesterday-pending", taskHandler.GetYesterdayPending).Methods("GET")
	taskRoutes.HandleFunc("/stats", taskHandler.GetStats).Methods("GET")
	taskRoutes.HandleFunc("/bulk-status", taskHandler.BulkUpdateStatus).Methods("PATCH")
	taskRoutes.HandleFunc("/by-date/{date}", taskHandler.GetTasksByDate).Methods("GET")
	taskRoutes.HandleFunc("/{id}", taskHandler.GetTask).Methods("GET")
	taskRoutes.HandleFunc("/{id}", taskHandler.UpdateTask).Methods("PUT")
	taskRoutes.HandleFunc("/{id}", taskHandler.DeleteTask).Methods("DELETE")
	taskRoutes.HandleFunc("/{id}/status", taskHandler.UpdateTaskStatus).Methods("PATCH")
	taskRoutes.HandleFunc("/{id}/section", taskHandler.UpdateTaskSection).Methods("PATCH")

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
	asanaRoutes.HandleFunc("/sections", asanaHandler.GetProjectSectionsFromDB).Methods("GET") // Get synced sections from DB
	asanaRoutes.HandleFunc("/import", asanaHandler.ImportFromEnv).Methods("POST")            // Quick import using env PAT

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
	taskAsanaRoutes.HandleFunc("/push", asanaHandler.PushToAsana).Methods("POST") // Push single task to Asana

	// Asana webhook endpoint (public - called by Asana)
	api.HandleFunc("/webhooks/asana", asanaHandler.HandleWebhook).Methods("POST")

	// Slack routes (protected)
	slackHandler := handlers.NewSlackHandler()
	slackRoutes := api.PathPrefix("/slack").Subrouter()
	slackRoutes.Use(middleware.AuthMiddleware)
	slackRoutes.HandleFunc("/connect", slackHandler.Connect).Methods("POST")
	slackRoutes.HandleFunc("/disconnect", slackHandler.Disconnect).Methods("POST")
	slackRoutes.HandleFunc("/status", slackHandler.GetStatus).Methods("GET")
	slackRoutes.HandleFunc("/channels", slackHandler.GetChannels).Methods("GET")
	slackRoutes.HandleFunc("/channel", slackHandler.SetChannel).Methods("POST")
	slackRoutes.HandleFunc("/messages", slackHandler.GetMessages).Methods("GET")
	slackRoutes.HandleFunc("/messages/yesterday", slackHandler.GetYesterdayMessages).Methods("GET")

	// AI Analysis routes (protected)
	aiHandler := handlers.NewAIHandler()
	aiRoutes := api.PathPrefix("/ai").Subrouter()
	aiRoutes.Use(middleware.AuthMiddleware)
	aiRoutes.HandleFunc("/analyze", aiHandler.AnalyzeSlackMessages).Methods("POST")
	aiRoutes.HandleFunc("/analyze-manual", aiHandler.AnalyzeManualInput).Methods("POST")
	aiRoutes.HandleFunc("/discrepancies", aiHandler.GetDiscrepancies).Methods("GET")

	// Daily Task Management routes (protected)
	dailyTaskHandler := handlers.NewDailyTaskHandler()
	dailyTaskRoutes := api.PathPrefix("/daily-tasks").Subrouter()
	dailyTaskRoutes.Use(middleware.AuthMiddleware)

	// Analysis endpoints
	dailyTaskRoutes.HandleFunc("/analysis", dailyTaskHandler.SaveAnalysis).Methods("POST")
	dailyTaskRoutes.HandleFunc("/analysis/{date}", dailyTaskHandler.GetAnalysisByDate).Methods("GET")

	// Today's tasks (from analysis)
	dailyTaskRoutes.HandleFunc("/today/{date}", dailyTaskHandler.GetTodaysTasks).Methods("GET")

	// Next day tasks (editable)
	dailyTaskRoutes.HandleFunc("/next-day/{date}", dailyTaskHandler.GetNextDayTasks).Methods("GET")
	dailyTaskRoutes.HandleFunc("/next-day/generate", dailyTaskHandler.GenerateNextDayTasks).Methods("POST")
	dailyTaskRoutes.HandleFunc("/next-day/task", dailyTaskHandler.CreateNextDayTask).Methods("POST")
	dailyTaskRoutes.HandleFunc("/next-day/task/{taskId}", dailyTaskHandler.UpdateNextDayTask).Methods("PATCH")
	dailyTaskRoutes.HandleFunc("/next-day/task/{taskId}", dailyTaskHandler.DeleteNextDayTask).Methods("DELETE")
	dailyTaskRoutes.HandleFunc("/next-day/reorder", dailyTaskHandler.ReorderNextDayTasks).Methods("PATCH")
	dailyTaskRoutes.HandleFunc("/next-day/{date}/slack-format", dailyTaskHandler.GetFormattedSlackMessage).Methods("GET")

	// Bot Config routes (protected)
	botConfigHandler := handlers.NewBotConfigHandler()
	botRoutes := api.PathPrefix("/bots").Subrouter()
	botRoutes.Use(middleware.AuthMiddleware)
	botRoutes.HandleFunc("", botConfigHandler.ListBots).Methods("GET")
	botRoutes.HandleFunc("/templates", botConfigHandler.GetTemplates).Methods("GET")
	botRoutes.HandleFunc("", botConfigHandler.CreateBot).Methods("POST")
	botRoutes.HandleFunc("/{id}", botConfigHandler.GetBot).Methods("GET")
	botRoutes.HandleFunc("/{id}", botConfigHandler.UpdateBot).Methods("PUT")
	botRoutes.HandleFunc("/{id}", botConfigHandler.DeleteBot).Methods("DELETE")

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

	// Whitelist/Access Control routes (protected - admin only)
	whitelistHandler := handlers.NewWhitelistHandler()
	whitelistRoutes := api.PathPrefix("/settings/access").Subrouter()
	whitelistRoutes.Use(middleware.AuthMiddleware)
	whitelistRoutes.HandleFunc("", whitelistHandler.GetWhitelistSettingsHandler).Methods("GET")
	whitelistRoutes.HandleFunc("/emails", whitelistHandler.GetAllowedEmailsHandler).Methods("GET")
	whitelistRoutes.HandleFunc("/emails", whitelistHandler.AddAllowedEmailHandler).Methods("POST")
	whitelistRoutes.HandleFunc("/emails/{email}", whitelistHandler.RemoveAllowedEmailHandler).Methods("DELETE")
	whitelistRoutes.HandleFunc("/domains", whitelistHandler.GetAllowedDomainsHandler).Methods("GET")
	whitelistRoutes.HandleFunc("/domains", whitelistHandler.AddAllowedDomainHandler).Methods("POST")
	whitelistRoutes.HandleFunc("/domains/{domain}", whitelistHandler.RemoveAllowedDomainHandler).Methods("DELETE")

	// Integration Settings routes
	settingsHandler := handlers.NewSettingsHandler()

	// Public route for checking if Asana is configured (all authenticated users)
	integrationStatusRoutes := api.PathPrefix("/settings/integrations").Subrouter()
	integrationStatusRoutes.Use(middleware.AuthMiddleware)
	integrationStatusRoutes.HandleFunc("/asana/status", settingsHandler.GetAsanaConfigStatus).Methods("GET")

	// Admin-only routes for managing settings
	integrationSettingsRoutes := api.PathPrefix("/settings/integrations").Subrouter()
	integrationSettingsRoutes.Use(middleware.AuthMiddleware)
	integrationSettingsRoutes.Use(middleware.AdminOnly)
	integrationSettingsRoutes.HandleFunc("/asana", settingsHandler.GetAsanaSettings).Methods("GET")
	integrationSettingsRoutes.HandleFunc("/asana", settingsHandler.UpdateAsanaSettings).Methods("PUT")
	integrationSettingsRoutes.HandleFunc("/asana/test", settingsHandler.TestAsanaConnection).Methods("POST")
	integrationSettingsRoutes.HandleFunc("/asana/projects", settingsHandler.GetAsanaProjects).Methods("GET")

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

	log.Printf("🚀 Project Management API server starting on port %s", port)
	log.Printf("📍 Health check: http://localhost:%s/api/health", port)

	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal("Server failed to start:", err)
	}
}

// Health check handler
func healthHandler(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Project Management API is running",
		Data: map[string]string{
			"version": "1.0.0",
			"status":  "healthy",
		},
	})
}

// NOTE: Task handlers moved to internal/handlers/tasks.go

// NOTE: Asana handlers moved to internal/handlers/asana.go
// NOTE: Slack handlers moved to internal/handlers/slack.go
// NOTE: AI handlers moved to internal/handlers/ai.go

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
