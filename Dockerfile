FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Workspace package dist is committed incompletely under a root dist/ gitignore —
# always rebuild before bundling the app.
RUN npm run build --workspace=@nimconnect/profile-client

# Baked in at build time — set to the public API URL (e.g. https://api-nimconnect.nimiqminiapps.com).
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Root base path for custom domain / Swarm (not GitHub Pages /NimConnect/).
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
