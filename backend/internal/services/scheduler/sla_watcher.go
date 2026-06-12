package scheduler

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	slacksvc "github.com/dhindsa/project-management/internal/services/slack"
)

// SLA thresholds per tier (hours in non-done state before alerting)
const (
	slaTier1Hours = 1.0  // Critical / Hotfix
	slaTier2Hours = 24.0 // Urgent / P1 / A1
)

// tierLabel maps a tier number to a human-readable label.
func tierLabel(tier int) string {
	switch tier {
	case 1:
		return "CRITICAL"
	case 2:
		return "URGENT"
	default:
		return "NORMAL"
	}
}

// slaThreshold returns the hours threshold for a given tier.
func slaThreshold(tier int) float64 {
	if tier == 1 {
		return slaTier1Hours
	}
	return slaTier2Hours
}

// checkSLABreaches scans all sprint issues and fires alerts + Slack messages
// for Tier-1/2 tickets whose time-in-state exceeds the SLA threshold.
// Runs every 5 minutes. Deduplicates via sprint_alerts UNIQUE constraint.
func (s *Service) checkSLABreaches(ctx context.Context) {
	pool := database.GetPool()
	if pool == nil {
		return
	}

	// Look back 30 days to cover any active sprint window
	since := time.Now().AddDate(0, 0, -30)
	issues, err := s.reportRepo.GetSprintRadarIssues(ctx, &since, nil)
	if err != nil {
		log.Printf("[SLAWatcher] GetSprintRadarIssues failed: %v", err)
		return
	}

	// Only Tier 1 and 2 that are NOT done
	var candidates []database.RadarIssue
	for _, ri := range issues {
		if (ri.Tier == 1 || ri.Tier == 2) && !ri.IsDone {
			candidates = append(candidates, ri)
		}
	}

	if len(candidates) == 0 {
		return
	}

	// Get all users with Slack integrations to notify them
	userIDs, err := s.slackRepo.GetAllConnectedSlackUsers(ctx)
	if err != nil {
		userIDs = []string{}
	}

	breachCount := 0
	for _, ri := range candidates {
		threshold := slaThreshold(ri.Tier)
		if ri.HoursInState < threshold {
			continue
		}

		msg := buildSLAMessage(ri, threshold)

		// Upsert alert for each connected user
		for _, userID := range userIDs {
			alertID, isNew, err := s.reportRepo.UpsertSprintAlert(
				ctx, userID, ri.IssueID, ri.IssueSummary,
				ri.Priority, ri.IssueType, ri.CurrentState,
				ri.Assignee, msg, ri.Tier, ri.HoursInState,
			)
			if err != nil {
				log.Printf("[SLAWatcher] UpsertSprintAlert %s user %s: %v", ri.IssueID, userID, err)
				continue
			}

			// Only send Slack once per alert (isNew = first time this issue+tier breached)
			if isNew {
				breachCount++
				s.sendSLASlackAlert(ctx, userID, ri, msg, alertID)
			}
		}
	}

	if breachCount > 0 {
		log.Printf("[SLAWatcher] %d new SLA breach(es) detected and alerted", breachCount)
	}
}

func buildSLAMessage(ri database.RadarIssue, threshold float64) string {
	typeStr := ""
	if ri.IssueType != "" {
		typeStr = fmt.Sprintf(" [%s]", ri.IssueType)
	}
	return fmt.Sprintf(
		"%s %s%s has been in *%s* for %.1fh (SLA: %.0fh). Assignee: %s.",
		tierLabel(ri.Tier), ri.IssueID, typeStr,
		ri.CurrentState, ri.HoursInState, threshold,
		ifEmpty(ri.Assignee, "Unassigned"),
	)
}

func (s *Service) sendSLASlackAlert(ctx context.Context, userID string, ri database.RadarIssue, msg string, alertID int) {
	integration, err := s.integrationRepo.GetSlackIntegration(ctx, userID)
	if err != nil || integration == nil || !integration.Connected || integration.BotToken == "" {
		return
	}

	if integration.ChannelID == nil || *integration.ChannelID == "" {
		return
	}
	channelID := *integration.ChannelID

	emoji := "🔴"
	if ri.Tier == 2 {
		emoji = "🟡"
	}

	slackText := fmt.Sprintf("%s *Sprint Pulse Alert* — %s\n%s", emoji, tierLabel(ri.Tier), msg)

	client := slacksvc.NewClient(integration.BotToken)
	if _, err := client.PostMessage(ctx, channelID, slackText); err != nil {
		log.Printf("[SLAWatcher] Slack PostMessage failed for user %s issue %s: %v", userID, ri.IssueID, err)
		return
	}

	if err := s.reportRepo.MarkSlackNotified(ctx, alertID); err != nil {
		log.Printf("[SLAWatcher] MarkSlackNotified failed alertID=%d: %v", alertID, err)
	}
}

func ifEmpty(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}
