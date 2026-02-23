package slack

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/models"
)

// Service handles Slack integration logic
type Service struct {
	integrationRepo *database.IntegrationRepository
}

// NewService creates a new Slack service
func NewService() *Service {
	return &Service{
		integrationRepo: database.NewIntegrationRepository(),
	}
}

// EnrichedMessage contains message with resolved user info
type EnrichedMessage struct {
	ID        string    `json:"id"`
	ChannelID string    `json:"channel_id"`
	UserID    string    `json:"user_id"`
	UserName  string    `json:"user_name"`
	Text      string    `json:"text"`
	Timestamp time.Time `json:"timestamp"`
	ThreadTS  *string   `json:"thread_ts,omitempty"`
}

// Connect connects a Slack bot to the user's account
func (s *Service) Connect(ctx context.Context, userID, botToken, channelID string) (*models.SlackIntegration, error) {
	// Verify the token
	client := NewClient(botToken)
	teamInfo, err := client.AuthTest(ctx)
	if err != nil {
		return nil, fmt.Errorf("invalid bot token: %w", err)
	}

	// Get channel name if channel ID provided
	var channelName *string
	if channelID != "" {
		channels, err := client.GetChannels(ctx)
		if err == nil {
			for _, ch := range channels {
				if ch.ID == channelID {
					channelName = &ch.Name
					break
				}
			}
		}
		// Note: bot should be manually invited to the channel via /invite
	}

	// Save the integration
	integration := &models.SlackIntegration{
		UserID:      userID,
		BotToken:    botToken,
		TeamID:      teamInfo.ID,
		TeamName:    teamInfo.Name,
		ChannelID:   &channelID,
		ChannelName: channelName,
		Connected:   true,
	}

	if err := s.integrationRepo.SaveSlackIntegration(ctx, integration); err != nil {
		return nil, fmt.Errorf("failed to save integration: %w", err)
	}

	return integration, nil
}

// Disconnect disconnects the Slack integration
func (s *Service) Disconnect(ctx context.Context, userID string) error {
	return s.integrationRepo.DisconnectSlack(ctx, userID)
}

// GetStatus returns the current Slack connection status
func (s *Service) GetStatus(ctx context.Context, userID string) (*models.SlackIntegration, error) {
	return s.integrationRepo.GetSlackIntegration(ctx, userID)
}

// GetChannels returns available channels
func (s *Service) GetChannels(ctx context.Context, userID string) ([]Channel, error) {
	integration, err := s.integrationRepo.GetSlackIntegration(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get integration: %w", err)
	}

	if !integration.Connected {
		return nil, fmt.Errorf("slack not connected")
	}

	client := NewClient(integration.BotToken)
	return client.GetChannels(ctx)
}

// SetChannel sets the channel to monitor
func (s *Service) SetChannel(ctx context.Context, userID, channelID, channelName string) error {
	integration, err := s.integrationRepo.GetSlackIntegration(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to get integration: %w", err)
	}

	if !integration.Connected {
		return fmt.Errorf("slack not connected")
	}

	// Note: bot should be manually invited to the channel via /invite
	return s.integrationRepo.UpdateSlackChannel(ctx, userID, channelID, channelName)
}

// GetMessages retrieves messages from the configured channel
func (s *Service) GetMessages(ctx context.Context, userID string, from, to time.Time) ([]EnrichedMessage, error) {
	integration, err := s.integrationRepo.GetSlackIntegration(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get integration: %w", err)
	}

	if !integration.Connected {
		return nil, fmt.Errorf("slack not connected")
	}

	if integration.ChannelID == nil || *integration.ChannelID == "" {
		return nil, fmt.Errorf("no channel configured")
	}

	client := NewClient(integration.BotToken)

	// Get messages from the channel
	messages, err := client.GetChannelHistory(ctx, *integration.ChannelID, from.Unix(), to.Unix(), 500)
	if err != nil {
		return nil, fmt.Errorf("failed to get messages: %w", err)
	}

	// Cache for user lookups
	userCache := make(map[string]*User)

	// Enrich messages with user info
	enriched := make([]EnrichedMessage, 0, len(messages))
	for _, msg := range messages {
		// Skip non-message types
		if msg.Type != "message" {
			continue
		}

		// Get user info
		var userName string
		if user, ok := userCache[msg.User]; ok {
			userName = user.RealName
			if userName == "" {
				userName = user.Profile.DisplayName
			}
		} else {
			user, err := client.GetUser(ctx, msg.User)
			if err == nil {
				userCache[msg.User] = user
				userName = user.RealName
				if userName == "" {
					userName = user.Profile.DisplayName
				}
			} else {
				userName = msg.User
			}
		}

		// Parse timestamp
		ts, err := parseSlackTimestamp(msg.TS)
		if err != nil {
			continue
		}

		var threadTS *string
		if msg.ThreadTS != "" {
			threadTS = &msg.ThreadTS
		}

		enriched = append(enriched, EnrichedMessage{
			ID:        msg.TS,
			ChannelID: *integration.ChannelID,
			UserID:    msg.User,
			UserName:  userName,
			Text:      msg.Text,
			Timestamp: ts,
			ThreadTS:  threadTS,
		})
	}

	// Save messages to database for AI analysis
	for _, msg := range enriched {
		dbMsg := &models.SlackMessage{
			ID:        msg.ID,
			ChannelID: msg.ChannelID,
			UserID:    msg.UserID,
			UserName:  msg.UserName,
			Text:      msg.Text,
			Timestamp: msg.Timestamp,
			ThreadTS:  msg.ThreadTS,
		}
		s.integrationRepo.SaveSlackMessage(ctx, dbMsg)
	}

	return enriched, nil
}

// GetYesterdayMessages retrieves messages from yesterday
func (s *Service) GetYesterdayMessages(ctx context.Context, userID string) ([]EnrichedMessage, error) {
	now := time.Now()
	yesterday := now.AddDate(0, 0, -1)
	startOfYesterday := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 0, 0, 0, 0, now.Location())
	endOfYesterday := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 23, 59, 59, 0, now.Location())

	return s.GetMessages(ctx, userID, startOfYesterday, endOfYesterday)
}

// parseSlackTimestamp converts Slack timestamp to time.Time
func parseSlackTimestamp(ts string) (time.Time, error) {
	parts := splitSlackTimestamp(ts)
	if len(parts) == 0 {
		return time.Time{}, fmt.Errorf("invalid timestamp")
	}

	secs, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return time.Time{}, err
	}

	return time.Unix(secs, 0), nil
}

// splitSlackTimestamp splits the Slack timestamp (e.g., "1234567890.123456")
func splitSlackTimestamp(ts string) []string {
	for i, c := range ts {
		if c == '.' {
			return []string{ts[:i], ts[i+1:]}
		}
	}
	return []string{ts}
}
