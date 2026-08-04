package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"sort"
	"sync"
	"time"
)

// Stats tracks unique wallet addresses and app opens per UTC day in Postgres.
type Stats struct {
	mu  sync.Mutex
	db  *sql.DB
	now func() time.Time
}

type DayStats struct {
	Wallets map[string]bool `json:"wallets"`
	Opens   int             `json:"opens"`
}

func NewStats(db *sql.DB) *Stats {
	return &Stats{db: db, now: time.Now}
}

func (s *Stats) dayKey() string {
	return s.now().UTC().Format("2006-01-02")
}

func (s *Stats) ensureDay(day string) error {
	_, err := s.db.Exec(`
		INSERT INTO stats_days (day, opens) VALUES ($1::date, 0)
		ON CONFLICT (day) DO NOTHING`, day)
	return err
}

func (s *Stats) RecordWallet(address string) {
	addr := compactAddress(address)
	if addr == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	day := s.dayKey()
	if err := s.ensureDay(day); err != nil {
		return
	}
	_, _ = s.db.Exec(`
		INSERT INTO stats_day_wallets (day, address) VALUES ($1::date, $2)
		ON CONFLICT DO NOTHING`, day, addr)
}

func (s *Stats) RecordOpen() {
	s.mu.Lock()
	defer s.mu.Unlock()
	day := s.dayKey()
	_, _ = s.db.Exec(`
		INSERT INTO stats_days (day, opens) VALUES ($1::date, 1)
		ON CONFLICT (day) DO UPDATE SET opens = stats_days.opens + 1`, day)
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

func (s *Stats) loadDays() (map[string]*DayStats, error) {
	days := map[string]*DayStats{}
	rows, err := s.db.Query(`SELECT day::text, opens FROM stats_days ORDER BY day`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var day string
		var opens int
		if err := rows.Scan(&day, &opens); err != nil {
			return nil, err
		}
		days[day] = &DayStats{Wallets: map[string]bool{}, Opens: opens}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	walletRows, err := s.db.Query(`SELECT day::text, address FROM stats_day_wallets`)
	if err != nil {
		return nil, err
	}
	defer walletRows.Close()
	for walletRows.Next() {
		var day, addr string
		if err := walletRows.Scan(&day, &addr); err != nil {
			return nil, err
		}
		d, ok := days[day]
		if !ok {
			d = &DayStats{Wallets: map[string]bool{}}
			days[day] = d
		}
		d.Wallets[addr] = true
	}
	return days, walletRows.Err()
}

func (s *Stats) Summary(handleStats HandleStats) statsSummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	loaded, err := s.loadDays()
	if err != nil {
		return statsSummary{UniqueHandles: handleStats.UniqueHandles, Days: []daySummary{}}
	}
	all := map[string]bool{}
	byDay := map[string]*daySummary{}
	out := statsSummary{
		UniqueHandles: handleStats.UniqueHandles,
		Days:          []daySummary{},
	}
	for day, d := range loaded {
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
