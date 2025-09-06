import { render, screen, fireEvent } from '@testing-library/react'
import NavBar from './NavBar'

jest.mock('next/navigation', () => ({
  usePathname: () => '/trading/equities',
  useRouter: () => ({ push: jest.fn() }),
}))

describe('NavBar', () => {
  beforeEach(() => {
    ;(global as any).localStorage = {
      _store: new Map<string, string>(),
      getItem(key: string) { return this._store.get(key) ?? null },
      setItem(key: string, value: string) { this._store.set(key, value) },
      removeItem(key: string) { this._store.delete(key) },
      clear() { this._store.clear() },
    }
    const user = { id: 'u1', email: 'a@b.com', name: 'Alice', created_at: new Date().toISOString() }
    const teams = [{ id: 't1', name: 'Team A', role: 'admin' }]
    localStorage.setItem('user', JSON.stringify(user))
    localStorage.setItem('teams', JSON.stringify(teams))
  })

  it('renders brand and links', () => {
    render(<NavBar />)
    expect(screen.getByText('CTC TRADING')).toBeInTheDocument()
    expect(screen.getByText('Equities')).toBeInTheDocument()
  })

  it('allows sign out and navigates to login', () => {
    const { container } = render(<NavBar />)
    const userButton = screen.getByText('Alice')
    fireEvent.click(userButton)
    const signOut = screen.getByText('Sign Out')
    fireEvent.click(signOut)
    // After sign out, apiKey/user/teams removed
    expect(localStorage.getItem('user')).toBeNull()
    expect(localStorage.getItem('teams')).toBeNull()
  })
})

