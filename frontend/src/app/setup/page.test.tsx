import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Page from './page'

// Mock router with stable identity across renders
const pushMock = jest.fn()
const mockRouter = { push: pushMock }
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))

// Minimal fetch mock
beforeEach(() => {
  jest.clearAllMocks()
  ;(global as any).fetch = jest.fn(async (url: string, init?: any) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ api_key: 'key', user: { id: 'u', email: 'e', name: 'n', created_at: new Date().toISOString() }, teams: [] }),
    } as any
  })
  // Seed pending
  window.localStorage.setItem('pendingRegistration', JSON.stringify({ id_token: 'tok', openid_sub: 'sub', email: 'e', name: 'n' }))
})

afterEach(() => {
  window.localStorage.clear()
})

describe('SetupPage', () => {
  // Increase Jest timeout for slower CI machines
  jest.setTimeout(20000)
  it('creates a team and redirects', async () => {
    render(<Page />)
    const nameInput = await screen.findByPlaceholderText('e.g., Alpha')
    await userEvent.type(nameInput, 'Alpha')
    await userEvent.click(screen.getByRole('button', { name: /Create & Continue/i }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/trading/equities'))
    expect(window.localStorage.getItem('apiKey')).toBe('key')
  })

  it('joins a team when join code entered', async () => {
    render(<Page />)
    await userEvent.click(screen.getByRole('button', { name: 'Join Team' }))
    const codeInput = await screen.findByPlaceholderText('e.g., 1A2B3C4D')
    await userEvent.type(codeInput, 'ABC12345')
    await userEvent.click(screen.getByRole('button', { name: /Join & Continue/i }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/trading/equities'))
  })
})
