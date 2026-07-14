package main

import (
	"encoding/json"
	"html/template"
	"net/http"
)

// publicPageTemplate is the OG shell: crawlers read the meta tags, humans get
// redirected to the SPA. html/template contextually escapes all fields.
var publicPageTemplate = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title>
<meta property="og:type" content="profile">
<meta property="og:title" content="{{.Title}}">
<meta property="og:description" content="{{.Description}}">
<meta property="og:url" content="{{.URL}}">
<meta property="og:site_name" content="NimConnect">
<meta name="twitter:card" content="summary">
<meta http-equiv="refresh" content="0;url={{.Redirect}}">
</head>
<body>
<p><a href="{{.Redirect}}">Continue to {{.Title}} on NimConnect</a></p>
<script>location.replace({{.Redirect}});</script>
</body>
</html>`))

type publicPageData struct {
	Title       string
	Description string
	URL         string
	Redirect    string
}

func publicPageHandler(registry *HandleRegistry, profiles *ProfileStore, appOrigin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handle := r.PathValue("handle")
		if !isValidHandle(handle) {
			writeJSONError(w, http.StatusBadRequest, "invalid handle")
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=300")

		claim, ok := registry.Resolve(handle)
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_ = publicPageTemplate.Execute(w, publicPageData{
				Title:       "NimConnect",
				Description: "This handle isn't claimed yet.",
				URL:         appOrigin,
				Redirect:    appOrigin,
			})
			return
		}

		data := publicPageData{
			Title:       "@" + handle + " — NimConnect",
			Description: "Send NIM to @" + handle + " on NimConnect.",
			URL:         appOrigin + "/@" + handle,
			Redirect:    appOrigin + "/#/u/" + handle,
		}
		if stored, err := profiles.Get(claim.Address); err == nil {
			var p struct {
				DisplayName string `json:"display_name"`
				Bio         string `json:"bio"`
			}
			if json.Unmarshal([]byte(stored.Profile), &p) == nil {
				if p.DisplayName != "" {
					data.Title = p.DisplayName + " (@" + handle + ") — NimConnect"
				}
				if p.Bio != "" {
					data.Description = p.Bio
				}
			}
		}
		_ = publicPageTemplate.Execute(w, data)
	}
}
