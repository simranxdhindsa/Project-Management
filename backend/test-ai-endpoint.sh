#!/bin/bash

echo "Testing AI Analysis Endpoint..."
echo ""

curl -X POST http://localhost:8080/api/ai/analyze-manual \
  -H "Authorization: Bearer dev-mode-token-test" \
  -H "Content-Type: application/json" \
  -d '{
    "morning_assignments": "`todays task list`\n\n`@Rajvir Singh`\n• PDF page numbers deprecation (High)\n• No confirmation modal for quit course\n\n`@Harpinder Singh`\n• Report API first access issue",
    "evening_updates": "Updates:\n@Rajvir: Completed PDF deprecation. Working on modal.\n@Harpinder: Report API is done."
  }' | python -m json.tool

echo ""
echo "✅ Endpoint is working!"
