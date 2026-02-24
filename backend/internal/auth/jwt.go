package auth

import (
	"errors"
	"os"
	"time"

	"github.com/dhindsa/project-management/internal/models"
	"github.com/golang-jwt/jwt/v5"
)

var jwtSecret []byte

func init() {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "development-secret-key-change-in-production"
	}
	jwtSecret = []byte(secret)
}

// Token duration constants
const (
	ShortTokenDuration = 24 * time.Hour       // 1 day for non-remember-me
	LongTokenDuration  = 30 * 24 * time.Hour  // 30 days for remember-me
)

// CustomClaims extends jwt.RegisteredClaims with user info
type CustomClaims struct {
	UserID     string      `json:"user_id"`
	Email      string      `json:"email"`
	Role       models.Role `json:"role"`
	RememberMe bool        `json:"remember_me"`
	jwt.RegisteredClaims
}

// GenerateToken creates a new JWT token for a user (default: 24 hours)
func GenerateToken(user *models.User) (string, error) {
	return GenerateTokenWithDuration(user, false)
}

// GenerateTokenWithDuration creates a JWT token with configurable duration
func GenerateTokenWithDuration(user *models.User, rememberMe bool) (string, error) {
	duration := ShortTokenDuration
	if rememberMe {
		duration = LongTokenDuration
	}

	claims := CustomClaims{
		UserID:     user.ID,
		Email:      user.Email,
		Role:       user.Role,
		RememberMe: rememberMe,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "project-management",
			Subject:   user.ID,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// ValidateToken verifies a JWT token and returns the claims
func ValidateToken(tokenString string) (*CustomClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &CustomClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*CustomClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("invalid token")
}

// RefreshToken generates a new token if the current one is valid
// It preserves the remember_me setting from the original token
func RefreshToken(tokenString string) (string, error) {
	claims, err := ValidateToken(tokenString)
	if err != nil {
		return "", err
	}

	// Create a new user from claims to generate fresh token
	user := &models.User{
		ID:    claims.UserID,
		Email: claims.Email,
		Role:  claims.Role,
	}

	// Preserve the remember_me setting - this resets the 30-day timer
	return GenerateTokenWithDuration(user, claims.RememberMe)
}

// GetTokenRemainingTime returns how much time is left before token expires
func GetTokenRemainingTime(tokenString string) (time.Duration, error) {
	claims, err := ValidateToken(tokenString)
	if err != nil {
		return 0, err
	}

	if claims.ExpiresAt == nil {
		return 0, errors.New("token has no expiration")
	}

	return time.Until(claims.ExpiresAt.Time), nil
}


// Random code snippet 1: A simple function to calculate factorial
// # def factorial(n):
// #     if n == 0:
// #         return 1
// #     else:
// #         return n * factorial(n-1)