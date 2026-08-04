import { createRouter, createWebHashHistory } from 'vue-router'
import { MARKETPLACE_ENABLED } from './config/features'
import { canonicalHashRoute } from './services/hash-routing'

const canonicalRoute = canonicalHashRoute(window.location.pathname, window.location.search, window.location.hash)
if (canonicalRoute) window.history.replaceState(null, '', canonicalRoute)

const marketplaceRoutes = MARKETPLACE_ENABLED
  ? [
      { path: '/marketplace', component: () => import('./pages/desktop/DesktopMarketplacePage.vue') },
      { path: '/marketplace/sell', component: () => import('./pages/desktop/DesktopMarketplaceSellPage.vue') },
      { path: '/marketplace/buy', component: () => import('./pages/desktop/DesktopMarketplaceBuyPage.vue') },
      { path: '/marketplace/trades/:id', component: () => import('./pages/desktop/DesktopMarketplaceTradePage.vue') },
    ]
  : [
      { path: '/marketplace/:pathMatch(.*)*', redirect: '/' },
    ]

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('./pages/PortalHomePage.vue') },
    { path: '/contacts', component: () => import('./pages/ContactsPage.vue') },
    { path: '/friends', component: () => import('./pages/FriendsPage.vue') },
    { path: '/profile/:id', component: () => import('./pages/ProfileDetailsPage.vue') },
    { path: '/add', component: () => import('./pages/ProfileFormPage.vue') },
    { path: '/edit/:id', component: () => import('./pages/ProfileFormPage.vue') },
    { path: '/me', component: () => import('./pages/PortalMePage.vue') },
    { path: '/settings', component: () => import('./pages/SettingsPage.vue') },
    { path: '/pay', component: () => import('./pages/PayPage.vue') },
    { path: '/u/:handle', component: () => import('./pages/PublicProfilePage.vue') },
    { path: '/insights', component: () => import('./pages/InsightsPage.vue') },
    { path: '/lookup', component: () => import('./pages/desktop/DesktopLookupPage.vue') },
    { path: '/about', component: () => import('./pages/desktop/DesktopAboutPage.vue') },
    ...marketplaceRoutes,
    { path: '/admin/stats', component: () => import('./pages/AdminStatsPage.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
