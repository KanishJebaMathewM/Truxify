#!/bin/zsh
set -e

UPSTREAM_REPO="KanishJebaMathewM/Truxify"
HEAD_USER="RishiByte"

# Array of features to process
features=(
  "driver-statement-csv"
  "driver-statement-sorting"
  "support-categories-descriptions"
  "support-categories-sla"
  "support-ticket-comments-pagination"
  "support-ticket-comments-sorting"
  "trip-events-bounding-box"
  "trip-events-sorting"
  "truck-management-filtering"
  "truck-management-search"
)

# Details maps for issues and PRs
declare -A issue_titles
declare -A issue_bodies
declare -A pr_titles
declare -A pr_bodies

issue_titles[driver-statement-csv]="perf: optimize memory usage in driver statement CSV generation"
issue_bodies[driver-statement-csv]="Optimize the CSV generation in GET /api/profile/driver/statement by replacing memory-heavy array spreads with a direct loop-based string builder."
pr_titles[driver-statement-csv]="perf: optimize memory usage in driver statement CSV generation"
pr_bodies[driver-statement-csv]="Optimize CSV generation by building the output string using a loop instead of array spreads, avoiding duplication of intermediate arrays in memory."

issue_titles[driver-statement-sorting]="feat: implement deterministic sorting for driver statements"
issue_bodies[driver-statement-sorting]="Add a secondary date sorting fallback to GET /api/profile/driver/statement sorting choices to ensure deterministic results."
pr_titles[driver-statement-sorting]="feat: implement deterministic sorting for driver statements"
pr_bodies[driver-statement-sorting]="Adds secondary chronological sorting by pickup date to the net earnings and base freight sorting parameters."

issue_titles[support-categories-descriptions]="perf: cache static support ticket categories endpoint"
issue_bodies[support-categories-descriptions]="Add public Cache-Control headers to the static support ticket categories endpoint since it serves configuration information."
pr_titles[support-categories-descriptions]="perf: cache static support ticket categories endpoint"
pr_bodies[support-categories-descriptions]="Exposes Cache-Control public headers with a 1-day max-age for static support categories metadata."

issue_titles[support-categories-sla]="perf: freeze support category SLA map"
issue_bodies[support-categories-sla]="Seal and freeze the static support category SLA object to prevent accidental runtime modifications and optimize JS compilation."
pr_titles[support-categories-sla]="perf: freeze support category SLA map"
pr_bodies[support-categories-sla]="Freezes the CATEGORY_SLA static object using Object.freeze to optimize JS runtime compilation."

issue_titles[support-ticket-comments-pagination]="fix: resolve duplicate declaration syntax error in ticket comments query"
issue_bodies[support-ticket-comments-pagination]="Fix the SyntaxError on limit and offset duplicate declarations in support ticket comments endpoint."
pr_titles[support-ticket-comments-pagination]="fix: resolve duplicate declaration syntax error in ticket comments query"
pr_bodies[support-ticket-comments-pagination]="Fixes a block-scoped variable redeclaration SyntaxError in the support ticket comments controller."

issue_titles[support-ticket-comments-sorting]="feat: add strict sort parameter validation for ticket comments query"
issue_bodies[support-ticket-comments-sorting]="Add strict input validation to ensure the sort parameter is either asc or desc in the support ticket comments API."
pr_titles[support-ticket-comments-sorting]="feat: add strict sort parameter validation for ticket comments query"
pr_bodies[support-ticket-comments-sorting]="Restricts the support ticket comments sort query parameter to valid 'asc' or 'desc' values, rejecting invalid values with a 400 response."

issue_titles[trip-events-bounding-box]="perf: push down trip event geographic bounding box filtering to database query"
issue_bodies[trip-events-bounding-box]="Push coordinate boundary filtering directly to the Supabase query level in GET /api/v1/trips/:id/events to optimize memory and database network traffic."
pr_titles[trip-events-bounding-box]="perf: push down trip event geographic bounding box filtering to database query"
pr_bodies[trip-events-bounding-box]="Pushes down coordinates filters (min_lat, max_lat, min_lng, max_lng) directly to the Postgres database query, reducing in-memory filtering."

issue_titles[trip-events-sorting]="perf: document database sorting optimization in trip events endpoint"
issue_bodies[trip-events-sorting]="Document and ensure database sorting is optimized and enforced for trip events telemetry."
pr_titles[trip-events-sorting]="perf: document database sorting optimization in trip events endpoint"
pr_bodies[trip-events-sorting]="Ensures chronological sorting is pushed down to the database and adds comments documenting optimization details."

issue_titles[truck-management-filtering]="feat: add validation for min_capacity and max_capacity truck filters"
issue_bodies[truck-management-filtering]="Validate capacity query parameters strictly as positive numeric values in the trucks listing endpoint."
pr_titles[truck-management-filtering]="feat: add validation for min_capacity and max_capacity truck filters"
pr_bodies[truck-management-filtering]="Validates min_capacity and max_capacity as non-negative numbers before performing database lookup, responding with 400 on invalid input."

issue_titles[truck-management-search]="feat: sanitize and trim truck search name parameter"
issue_bodies[truck-management-search]="Trim and sanitize the name query parameter in the truck search endpoint before matching against the database."
pr_titles[truck-management-search]="feat: sanitize and trim truck search name parameter"
pr_bodies[truck-management-search]="Sanitizes name search values by trimming whitespace, avoiding unnecessary database wildcard searches for empty parameters."

# Store PIDs of background jobs
pids=()

echo "Starting branch preparation and push sequence..."

for feature in "${features[@]}"; do
  branch_name="feature/${feature}-opt"
  echo "--------------------------------------------------"
  echo "Preparing branch: $branch_name"
  
  # Checkout main and create fresh branch
  git checkout main
  git checkout -B "$branch_name"
  
  # Apply code change
  node scripts/apply_optimizations.js "$feature"
  
  # Commit and push
  git add .
  git commit -m "perf($feature): optimize $feature implementation"
  git push -f -u origin "$branch_name"
  
  # Start issue and PR creation in background to run concurrently
  title="${issue_titles[$feature]}"
  body="${issue_bodies[$feature]}"
  pr_title="${pr_titles[$feature]}"
  pr_body="${pr_bodies[$feature]}"
  
  (
    echo "Creating issue for $feature..."
    ISSUE_URL=$(gh issue create --repo "$UPSTREAM_REPO" \
      --title "$title" \
      --body "$body" \
      --label "backend" \
      --label "enhancement")
    echo "Created issue: $ISSUE_URL"
    ISSUE_NUM=$(echo "$ISSUE_URL" | grep -oE '[0-9]+$')
    
    echo "Creating PR for $feature..."
    PR_URL=$(gh pr create --repo "$UPSTREAM_REPO" \
      --head "${HEAD_USER}:${branch_name}" \
      --base "main" \
      --title "${pr_title} (#${ISSUE_NUM})" \
      --body "${pr_body} Resolves #${ISSUE_NUM}." \
      --label "backend" \
      --label "type:feature" \
      --label "gssoc:approved")
    echo "Created PR: $PR_URL"
  ) &
  pids+=($!)
done

# Go back to main branch
git checkout main

echo "Waiting for all issues and PRs to be created on GitHub..."
for pid in "${pids[@]}"; do
  wait "$pid"
done

echo "=================================================="
echo "All 10 issues and PRs created successfully!"
