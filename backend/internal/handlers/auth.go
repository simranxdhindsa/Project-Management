package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/dhindsa/project-management/internal/auth"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
)

// In-memory user store (replace with database in production)
var users = make(map[string]*models.User)
var usersMu sync.RWMutex

// In-memory whitelist (loaded from database or defaults)
var allowedEmails = map[string]models.Role{
	strings.ToLower(models.DefaultAdminEmail): models.RoleAdmin,
}
var allowedDomains = map[string]models.Role{
	"apyhub.com": models.RoleMember, // Allow all @apyhub.com users
}
var whitelistMu sync.RWMutex

// GoogleAuthRequest represents the request body for Google auth
type GoogleAuthRequest struct {
	Credential string `json:"credential"`  // ID token from Google Sign-In
	Code       string `json:"code"`        // Authorization code (alternative flow)
	RememberMe bool   `json:"remember_me"` // If true, token lasts 30 days
}

// Response helper
type Response struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// isEmailAllowed checks if an email is in the whitelist
func isEmailAllowed(email string) (bool, models.Role) {
	email = strings.ToLower(email)

	// Always allow the default admin
	if email == strings.ToLower(models.DefaultAdminEmail) {
		return true, models.RoleAdmin
	}

	whitelistMu.RLock()
	defer whitelistMu.RUnlock()

	// Check exact email match
	if role, ok := allowedEmails[email]; ok {
		return true, role
	}

	// Check domain match
	parts := strings.Split(email, "@")
	if len(parts) == 2 {
		domain := parts[1]
		if role, ok := allowedDomains[domain]; ok {
			return true, role
		}
	}

	return false, ""
}

// AddAllowedEmail adds an email to the whitelist
func AddAllowedEmail(email string, role models.Role) {
	whitelistMu.Lock()
	defer whitelistMu.Unlock()
	allowedEmails[strings.ToLower(email)] = role
}

// RemoveAllowedEmail removes an email from the whitelist
func RemoveAllowedEmail(email string) bool {
	email = strings.ToLower(email)
	// Don't allow removing the default admin
	if email == strings.ToLower(models.DefaultAdminEmail) {
		return false
	}
	whitelistMu.Lock()
	defer whitelistMu.Unlock()
	delete(allowedEmails, email)
	return true
}

// AddAllowedDomain adds a domain to the whitelist
func AddAllowedDomain(domain string, role models.Role) {
	whitelistMu.Lock()
	defer whitelistMu.Unlock()
	allowedDomains[strings.ToLower(domain)] = role
}

// RemoveAllowedDomain removes a domain from the whitelist
func RemoveAllowedDomain(domain string) {
	whitelistMu.Lock()
	defer whitelistMu.Unlock()
	delete(allowedDomains, strings.ToLower(domain))
}

// GetAllowedEmails returns all allowed emails
func GetAllowedEmails() map[string]models.Role {
	whitelistMu.RLock()
	defer whitelistMu.RUnlock()
	result := make(map[string]models.Role)
	for k, v := range allowedEmails {
		result[k] = v
	}
	return result
}

// GetAllowedDomains returns all allowed domains
func GetAllowedDomains() map[string]models.Role {
	whitelistMu.RLock()
	defer whitelistMu.RUnlock()
	result := make(map[string]models.Role)
	for k, v := range allowedDomains {
		result[k] = v
	}
	return result
}

// HandleGoogleAuth handles Google OAuth authentication
func HandleGoogleAuth(w http.ResponseWriter, r *http.Request) {
	var req GoogleAuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{
			Success: false,
			Message: "Invalid request body",
		})
		return
	}

	var googleUser *models.GoogleUserInfo
	var err error

	// Handle ID token (from Google Sign-In button)
	if req.Credential != "" {
		googleUser, err = auth.ValidateGoogleToken(req.Credential)
		if err != nil {
			sendJSON(w, http.StatusUnauthorized, Response{
				Success: false,
				Message: "Invalid Google token: " + err.Error(),
			})
			return
		}
	} else if req.Code != "" {
		// Handle authorization code flow
		accessToken, err := auth.ExchangeCodeForToken(req.Code)
		if err != nil {
			sendJSON(w, http.StatusUnauthorized, Response{
				Success: false,
				Message: "Failed to exchange code: " + err.Error(),
			})
			return
		}

		googleUser, err = auth.GetGoogleUserInfo(accessToken)
		if err != nil {
			sendJSON(w, http.StatusUnauthorized, Response{
				Success: false,
				Message: "Failed to get user info: " + err.Error(),
			})
			return
		}
	} else {
		sendJSON(w, http.StatusBadRequest, Response{
			Success: false,
			Message: "Either credential or code is required",
		})
		return
	}

	// Check if email is allowed
	allowed, assignedRole := isEmailAllowed(googleUser.Email)
	if !allowed {
		sendJSON(w, http.StatusForbidden, Response{
			Success: false,
			Message: "Access denied. Your email is not authorized to access this application. Please contact an administrator.",
		})
		return
	}

	usersMu.Lock()
	defer usersMu.Unlock()

	// Find or create user
	user, exists := users[googleUser.Email]
	if !exists {
		// Create new user with the role from whitelist
		user = &models.User{
			ID:        googleUser.ID,
			Email:     googleUser.Email,
			Name:      googleUser.Name,
			Picture:   googleUser.Picture,
			Role:      assignedRole,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		users[googleUser.Email] = user
	} else {
		// Update existing user info
		user.Name = googleUser.Name
		user.Picture = googleUser.Picture
		user.UpdatedAt = time.Now()
		// Don't change role for existing users unless they're the default admin
		if strings.ToLower(googleUser.Email) == strings.ToLower(models.DefaultAdminEmail) {
			user.Role = models.RoleAdmin
		}
	}

	// Generate JWT token with remember_me setting
	token, err := auth.GenerateTokenWithDuration(user, req.RememberMe)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to generate token",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: models.AuthResponse{
			User:  user,
			Token: token,
		},
	})
}

// HandleGetMe returns the current authenticated user
func HandleGetMe(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{
			Success: false,
			Message: "Not authenticated",
		})
		return
	}

	usersMu.RLock()
	fullUser, exists := users[user.Email]
	usersMu.RUnlock()

	if !exists {
		sendJSON(w, http.StatusNotFound, Response{
			Success: false,
			Message: "User not found",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    fullUser,
	})
}

// HandleLogout handles user logout
func HandleLogout(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Logged out successfully",
	})
}

// HandleRefreshToken refreshes the JWT token, preserving the remember_me setting
func HandleRefreshToken(w http.ResponseWriter, r *http.Request) {
	// Get the original token from header to preserve remember_me setting
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		sendJSON(w, http.StatusUnauthorized, Response{
			Success: false,
			Message: "Authorization header required",
		})
		return
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		sendJSON(w, http.StatusUnauthorized, Response{
			Success: false,
			Message: "Invalid authorization format",
		})
		return
	}

	// Refresh the token - this preserves the remember_me setting and resets the timer
	newToken, err := auth.RefreshToken(parts[1])
	if err != nil {
		sendJSON(w, http.StatusUnauthorized, Response{
			Success: false,
			Message: "Failed to refresh token: " + err.Error(),
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]string{
			"token": newToken,
		},
	})
}

// HandleGetAuthURL returns the Google OAuth URL
func HandleGetAuthURL(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "random-state-string"
	}

	authURL := auth.GetGoogleAuthURL(state)

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]string{
			"url": authURL,
		},
	})
}
