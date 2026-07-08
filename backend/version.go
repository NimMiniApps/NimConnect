package main

import "time"

var (
	// CommitHash and BuildTime are set by Docker build ldflags in production.
	CommitHash = "dev"
	BuildTime  = "unknown"
	startedAt  = time.Now().UTC()
)

type VersionResponse struct {
	Service       string `json:"service"`
	CommitHash    string `json:"commit_hash"`
	BuildTime     string `json:"build_time"`
	StartedAt     string `json:"started_at"`
	UptimeSeconds int64  `json:"uptime_seconds"`
}

func currentVersion() VersionResponse {
	return VersionResponse{
		Service:       "nimconnect-backend",
		CommitHash:    CommitHash,
		BuildTime:     BuildTime,
		StartedAt:     startedAt.Format(time.RFC3339),
		UptimeSeconds: int64(time.Since(startedAt).Seconds()),
	}
}
