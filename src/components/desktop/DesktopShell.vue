<template>
  <div class="desktop-shell" data-desktop-shell>
    <header class="desktop-shell__nav">
      <router-link to="/" class="desktop-shell__brand">NimConnect</router-link>
      <nav class="desktop-shell__links">
        <router-link to="/" class="desktop-shell__link">Home</router-link>
        <router-link to="/lookup" class="desktop-shell__link">Lookup</router-link>
        <router-link to="/me" class="desktop-shell__link">My Identity</router-link>
        <router-link to="/about" class="desktop-shell__link">About</router-link>
      </nav>
    </header>
    <main class="desktop-shell__main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.desktop-shell {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
}
.desktop-shell__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 20px 40px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
}
.desktop-shell__brand {
  font-size: 20px;
  font-weight: 800;
  color: var(--nimiq-blue);
  text-decoration: none;
  letter-spacing: -0.01em;
}
.desktop-shell__links {
  display: flex;
  align-items: center;
  gap: 28px;
}
.desktop-shell__link {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-2);
  text-decoration: none;
  transition: color var(--attr-duration) var(--nimiq-ease);
}
.desktop-shell__link:hover,
.desktop-shell__link.router-link-active {
  color: var(--nq-gold-dark);
}
.desktop-shell__main {
  flex: 1;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 48px 40px 96px;
}
</style>
