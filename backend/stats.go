package main

import (
	"encoding/json"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"
)

// Stats tracks unique wallet addresses and app opens per UTC day,
// persisted as a single JSON file.
type Stats struct {
	mu   sync.Mutex
	path string
	now  func() time.Time
	Days map[string]*DayStats `json:"days"`
}

type DayStats struct {
	Wallets map[string]bool `json:"wallets"`
	Opens   int             `json:"opens"`
}

func NewStats(path string) *Stats {
	s := &Stats{path: path, now: time.Now, Days: map[string]*DayStats{}}
	if data, err := os.ReadFile(path); err == nil {
		json.Unmarshal(data, s)
	}
	if s.Days == nil {
		s.Days = map[string]*DayStats{}
	}
	return s
}

func (s *Stats) day() *DayStats {
	key := s.now().UTC().Format("2006-01-02")
	d := s.Days[key]
	if d == nil {
		d = &DayStats{Wallets: map[string]bool{}}
		s.Days[key] = d
	}
	return d
}

func (s *Stats) RecordWallet(address string) {
	addr := compactAddress(address)
	if addr == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.day().Wallets[addr] = true
	s.save()
}

func (s *Stats) RecordOpen() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.day().Opens++
	s.save()
}

// ponytail: write-per-request; batch/debounce if traffic ever makes this hot.
func (s *Stats) save() {
	if s.path == "" {
		return
	}
	data, err := json.Marshal(s)
	if err != nil {
		return
	}
	tmp := s.path + ".tmp"
	if os.WriteFile(tmp, data, 0o600) == nil {
		os.Rename(tmp, s.path)
	}
}

type daySummary struct {
	Day     string `json:"day"`
	Wallets int    `json:"wallets"`
	Opens   int    `json:"opens"`
	Handles int    `json:"handles"`
}

type statsSummary struct {
	UniqueWallets int          `json:"unique_wallets"`
	UniqueHandles int          `json:"unique_handles"`
	TotalOpens    int          `json:"total_opens"`
	Days          []daySummary `json:"days"`
}

func (s *Stats) Summary(handleStats HandleStats) statsSummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	all := map[string]bool{}
	byDay := map[string]*daySummary{}
	out := statsSummary{
		UniqueHandles: handleStats.UniqueHandles,
		Days:          []daySummary{},
	}
	for day, d := range s.Days {
		for w := range d.Wallets {
			all[w] = true
		}
		out.TotalOpens += d.Opens
		byDay[day] = &daySummary{Day: day, Wallets: len(d.Wallets), Opens: d.Opens}
	}
	for day, handles := range handleStats.Days {
		d := byDay[day]
		if d == nil {
			d = &daySummary{Day: day}
			byDay[day] = d
		}
		d.Handles = handles
	}
	for _, d := range byDay {
		out.Days = append(out.Days, *d)
	}
	out.UniqueWallets = len(all)
	sort.Slice(out.Days, func(i, j int) bool { return out.Days[i].Day < out.Days[j].Day })
	return out
}

// withWalletStat records the {address} path value before calling next.
func withWalletStat(stats *Stats, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stats.RecordWallet(r.PathValue("address"))
		next(w, r)
	}
}

func statsHandler(stats *Stats, sessions *AdminSessions, registry *HandleRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessions.Valid(r.Header.Get("X-Admin-Session")) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		handleStats := HandleStats{}
		if registry != nil {
			handleStats = registry.Stats()
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(stats.Summary(handleStats))
	}
}

func adminHandlesHandler(sessions *AdminSessions, registry *HandleRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessions.Valid(r.Header.Get("X-Admin-Session")) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		claims := []HandleClaim{}
		if registry != nil {
			claims = registry.Claims()
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string][]HandleClaim{"handles": claims})
	}
}
