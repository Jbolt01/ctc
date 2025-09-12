import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NavBar from './NavBar'

jest.mock('next/navigation', () => ({
  usePathname: () => '/trading/equities',
  useRouter: () => ({ push: jest.fn() }),
}))

// Mock API used via dynamic import in NavBar
jest.mock('../lib/api', () => ({
  adminListUsers: jest.fn().mockRejectedValue(new Error('not admin in tests')),
  teamGet: jest.fn().mockResolvedValue({ id: 't1', name: 'Team A', join_code: 'ABCDEFGH', role: 'admin', members: [] }),
  teamRotateCode: jest.fn().mockResolvedValue({ join_code: 'ZZZZZZZZ' }),
}))

import * as api from '../lib/api'

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
    localStorage.setItem('apiKey', 'k')
  })

  it('renders brand and links', () => {
    render(<NavBar />)
    expect(screen.getByText('CTC TRADING')).toBeInTheDocument()
    expect(screen.getByText('Equities')).toBeInTheDocument()
    expect(screen.getByText('Team')).toBeInTheDocument()
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

  it('shows join code and can regenerate for owner', async () => {
    render(<NavBar />)
    fireEvent.click(screen.getByText('Alice'))
    await screen.findByText(/Join code:/)
    expect(screen.getByText('ABCDEFGH')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }))
    await waitFor(() => expect((api.teamRotateCode as jest.Mock)).toHaveBeenCalled())
  })
})
