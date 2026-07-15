export type ProfileShareAction = { kind: 'profile' | 'public'; link: string; title: string; label: string }

export function profileShareActions(profileLink: string, publicPageUrl?: string): ProfileShareAction[] {
  const actions: ProfileShareAction[] = [{ kind: 'profile', link: profileLink, title: 'NimConnect profile', label: 'Share profile link' }]
  if (publicPageUrl) actions.push({ kind: 'public', link: publicPageUrl, title: 'Public profile', label: 'Share public page' })
  return actions
}
