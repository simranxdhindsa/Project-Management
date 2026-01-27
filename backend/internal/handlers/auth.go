package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/dhindsa/tasksync-pro/internal/auth"
	"github.com/dhindsa/tasksync-pro/internal/middleware"
	"github.com/dhindsa/tasksync-pro/internal/models"
)

// In-memory user store (replace with database in production)
var users = make(map[string]*models.User)

// GoogleAuthRequest represents the request body for Google auth
type GoogleAuthRequest struct {
	Credential string `json:"credential"` // ID token from Google Sign-In
	Code       string `json:"code"`       // Authorization code (alternative flow)
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

	// Find or create user
	user, exists := users[googleUser.Email]
	if !exists {
		// Create new user
		user = &models.User{
			ID:        googleUser.ID,
			Email:     googleUser.Email,
			Name:      googleUser.Name,
			Picture:   googleUser.Picture,
			Role:      models.RoleMember, // Default role
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		// First user becomes admin
		if len(users) == 0 {
			user.Role = models.RoleAdmin
		}

		users[googleUser.Email] = user
	} else {
		// Update existing user info
		user.Name = googleUser.Name
		user.Picture = googleUser.Picture
		user.UpdatedAt = time.Now()
	}

	// Generate JWT token
	token, err := auth.GenerateToken(user)
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

	// Get full user info from store
	fullUser, exists := users[user.Email]
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
	// In a stateless JWT system, logout is handled client-side
	// by removing the token. This endpoint can be used for
	// token blacklisting in a more advanced implementation.
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Logged out successfully",
	})
}

// HandleRefreshToken refreshes the JWT token
func HandleRefreshToken(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{
			Success: false,
			Message: "Not authenticated",
		})
		return
	}

	// Get full user info
	fullUser, exists := users[user.Email]
	if !exists {
		sendJSON(w, http.StatusNotFound, Response{
			Success: false,
			Message: "User not found",
		})
		return
	}

	// Generate new token
	token, err := auth.GenerateToken(fullUser)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to generate token",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]string{
			"token": token,
		},
	})
}

// HandleGetAuthURL returns the Google OAuth URL
func HandleGetAuthURL(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "random-state-string" // In production, generate a secure random state
	}

	authURL := auth.GetGoogleAuthURL(state)

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]string{
			"url": authURL,
		},
	})
}
