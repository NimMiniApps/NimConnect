import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('./pages/HomePage.vue') },
    { path: '/contacts', component: () => import('./pages/ContactsPage.vue') },
    { path: '/profile/:id', component: () => import('./pages/ProfileDetailsPage.vue') },
    { path: '/add', component: () => import('./pages/ProfileFormPage.vue') },
    { path: '/edit/:id', component: () => import('./pages/ProfileFormPage.vue') },
    { path: '/me', component: () => import('./pages/MyProfilePage.vue') },
    { path: '/settings', component: () => import('./pages/SettingsPage.vue') },
    { path: '/pay', component: () => import('./pages/PayPage.vue') },
    { path: '/insights', component: () => import('./pages/InsightsPage.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
