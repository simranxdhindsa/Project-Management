package slack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

const (
	BaseURL = "https://slack.com/api"
)

// Client is the Slack API client
type Client struct {
	botToken   string
	httpClient *http.Client
}

// NewClient creates a new Slack API client
func NewClient(botToken string) *Client {
	return &Client{
		botToken: botToken,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Message represents a Slack message
type Message struct {
	TS        string `json:"ts"`
	User      string `json:"user"`
	Text      string `json:"text"`
	Type      string `json:"type"`
	ThreadTS  string `json:"thread_ts,omitempty"`
	ReplyCount int   `json:"reply_count,omitempty"`
}

// Channel represents a Slack channel
type Channel struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	IsPrivate  bool   `json:"is_private"`
	IsMember   bool   `json:"is_member"`
	NumMembers int    `json:"num_members"`
}

// User represents a Slack user
type User struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	RealName string  `json:"real_name"`
	Profile  Profile `json:"profile"`
}

// Profile contains Slack user profile info
type Profile struct {
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Image48     string `json:"image_48"`
}

// TeamInfo represents Slack team/workspace info
type TeamInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Response is a generic Slack API response
type Response struct {
	OK       bool            `json:"ok"`
	Error    string          `json:"error,omitempty"`
	Warning  string          `json:"warning,omitempty"`
	Metadata json.RawMessage `json:"response_metadata,omitempty"`
}

// doRequest performs an HTTP request to the Slack API
func (c *Client) doRequest(ctx context.Context, method, endpoint string, body interface{}) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, BaseURL+endpoint, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.botToken)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	return respBody, nil
}

// doGetRequest performs a GET request with query parameters
func (c *Client) doGetRequest(ctx context.Context, endpoint string, params url.Values) ([]byte, error) {
	reqURL := BaseURL + endpoint
	if len(params) > 0 {
		reqURL += "?" + params.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.botToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	return respBody, nil
}

// AuthTest tests the authentication and returns team info
func (c *Client) AuthTest(ctx context.Context) (*TeamInfo, error) {
	body, err := c.doRequest(ctx, http.MethodPost, "/auth.test", nil)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Response
		TeamID string `json:"team_id"`
		Team   string `json:"team"`
		UserID string `json:"user_id"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	if !resp.OK {
		return nil, fmt.Errorf("slack API error: %s", resp.Error)
	}

	return &TeamInfo{
		ID:   resp.TeamID,
		Name: resp.Team,
	}, nil
}

// GetChannels returns a list of channels the bot is a member of
func (c *Client) GetChannels(ctx context.Context) ([]Channel, error) {
	params := url.Values{}
	params.Set("types", "public_channel,private_channel")
	params.Set("exclude_archived", "true")

	body, err := c.doGetRequest(ctx, "/conversations.list", params)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Response
		Channels []Channel `json:"channels"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	if !resp.OK {
		return nil, fmt.Errorf("slack API error: %s", resp.Error)
	}

	return resp.Channels, nil
}

// GetChannelHistory returns messages from a channel within a time range
func (c *Client) GetChannelHistory(ctx context.Context, channelID string, oldest, latest int64, limit int) ([]Message, error) {
	params := url.Values{}
	params.Set("channel", channelID)
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	} else {
		params.Set("limit", "200")
	}
	if oldest > 0 {
		params.Set("oldest", fmt.Sprintf("%d", oldest))
	}
	if latest > 0 {
		params.Set("latest", fmt.Sprintf("%d", latest))
	}

	body, err := c.doGetRequest(ctx, "/conversations.history", params)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Response
		Messages []Message `json:"messages"`
		HasMore  bool      `json:"has_more"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	if !resp.OK {
		return nil, fmt.Errorf("slack API error: %s", resp.Error)
	}

	return resp.Messages, nil
}

// GetUser returns user info by ID
func (c *Client) GetUser(ctx context.Context, userID string) (*User, error) {
	params := url.Values{}
	params.Set("user", userID)

	body, err := c.doGetRequest(ctx, "/users.info", params)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Response
		User User `json:"user"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	if !resp.OK {
		return nil, fmt.Errorf("slack API error: %s", resp.Error)
	}

	return &resp.User, nil
}

// GetYesterdayMessages returns messages from yesterday for a channel
func (c *Client) GetYesterdayMessages(ctx context.Context, channelID string) ([]Message, error) {
	now := time.Now()
	// Yesterday start (00:00:00)
	yesterday := now.AddDate(0, 0, -1)
	startOfYesterday := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 0, 0, 0, 0, now.Location())
	// Yesterday end (23:59:59)
	endOfYesterday := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 23, 59, 59, 0, now.Location())

	return c.GetChannelHistory(ctx, channelID, startOfYesterday.Unix(), endOfYesterday.Unix(), 1000)
}

