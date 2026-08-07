package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
)

const awardsMaxBodyBytes = 4 * 1024

type createAwardRequest struct {
	Address       string          `json:"address"`
	AchievementID string          `json:"achievement_id"`
	Title         string          `json:"title"`
	Description   string          `json:"description"`
	Rarity        string          `json:"rarity"`
	Progress      json.RawMessage `json:"progress"`
	Visibility    string          `json:"visibility"`
}

func awardResponse(a Award) map[string]any {
	out := map[string]any{
		"app_id":         a.AppID,
		"achievement_id": a.AchievementID,
		"address":        a.Address,
		"title":          a.Title,
		"description":    a.Description,
		"rarity":         a.Rarity,
		"visibility":     a.Visibility,
		"granted_at":     a.GrantedAt.Unix(),
	}
	if len(a.Progress) > 0 {
		out["progress"] = a.Progress
	}
	return out
}

// awardsCreateHandler is app-authenticated (Authorization: Bearer <app api
// key>, see IssueAppAPIKey) rather than wallet-authenticated: an app awards
// achievements to a wallet, the wallet doesn't request them.
func awardsCreateHandler(awards *AwardStore, authStore *AuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		appID, err := authStore.ResolveAppByAPIKey(bearerToken(r))
		if err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, awardsMaxBodyBytes)
		var req createAwardRequest
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		stored, err := awards.Grant(Award{
			AppID: appID, AchievementID: req.AchievementID, Address: req.Address,
			Title: req.Title, Description: req.Description, Rarity: req.Rarity,
			Progress: req.Progress, Visibility: req.Visibility,
		})
		if errors.Is(err, errBadRequest) {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if err != nil {
			log.Printf("grant award error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "awards unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(awardResponse(stored))
	}
}

// achievementsListHandler is public for a wallet's public awards (a profile
// panel), and additionally includes private ones when the caller presents a
// scoped session for that same wallet with achievements:read.
func achievementsListHandler(awards *AwardStore, authStore *AuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		includePrivate := false
		if token := bearerToken(r); token != "" {
			actor, ok := resolveScopedActor(authStore, r, ScopeAchievementsRead)
			includePrivate = ok && compactAddress(actor.Address) == compactAddress(address)
		}
		list, err := awards.ListForAddress(address, includePrivate)
		if errors.Is(err, errBadRequest) {
			writeJSONError(w, http.StatusBadRequest, "invalid address")
			return
		}
		if err != nil {
			log.Printf("list achievements error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "awards unavailable")
			return
		}
		out := make([]map[string]any, 0, len(list))
		for _, a := range list {
			out = append(out, awardResponse(a))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"achievements": out})
	}
}
