import React, { createContext, useContext, useReducer } from 'react'
import type { Agent } from '../data/agents'

export type ViewMode = 'grid' | 'list'
export type ActivePanel = 'browse' | 'team' | 'detail'

interface StoreState {
  selectedDivision: string | null
  selectedAgent: Agent | null
  searchQuery: string
  teamAgents: Agent[]
  viewMode: ViewMode
  activePanel: ActivePanel
}

type StoreAction =
  | { type: 'SET_SELECTED_DIVISION'; payload: string | null }
  | { type: 'SET_SELECTED_AGENT'; payload: Agent | null }
  | { type: 'SET_SEARCH_QUERY'; payload: string }
  | { type: 'ADD_TO_TEAM'; payload: Agent }
  | { type: 'REMOVE_FROM_TEAM'; payload: string }
  | { type: 'CLEAR_TEAM' }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'SET_ACTIVE_PANEL'; payload: ActivePanel }

const initialState: StoreState = {
  selectedDivision: null,
  selectedAgent: null,
  searchQuery: '',
  teamAgents: [],
  viewMode: 'grid',
  activePanel: 'browse',
}

function storeReducer(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case 'SET_SELECTED_DIVISION':
      return { ...state, selectedDivision: action.payload }
    case 'SET_SELECTED_AGENT':
      return { ...state, selectedAgent: action.payload, activePanel: action.payload ? 'detail' : state.activePanel }
    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.payload }
    case 'ADD_TO_TEAM': {
      if (state.teamAgents.length >= 10) return state
      if (state.teamAgents.find(a => a.id === action.payload.id)) return state
      return { ...state, teamAgents: [...state.teamAgents, action.payload] }
    }
    case 'REMOVE_FROM_TEAM':
      return { ...state, teamAgents: state.teamAgents.filter(a => a.id !== action.payload) }
    case 'CLEAR_TEAM':
      return { ...state, teamAgents: [] }
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload }
    case 'SET_ACTIVE_PANEL':
      return { ...state, activePanel: action.payload }
    default:
      return state
  }
}

interface StoreContextValue {
  state: StoreState
  dispatch: React.Dispatch<StoreAction>
  setSelectedDivision: (id: string | null) => void
  setSelectedAgent: (agent: Agent | null) => void
  setSearchQuery: (query: string) => void
  addToTeam: (agent: Agent) => void
  removeFromTeam: (agentId: string) => void
  clearTeam: () => void
  setViewMode: (mode: ViewMode) => void
  setActivePanel: (panel: ActivePanel) => void
}

const StoreContext = createContext<StoreContextValue | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, dispatch] = useReducer(storeReducer, initialState)

  const value: StoreContextValue = {
    state,
    dispatch,
    setSelectedDivision: (id) => dispatch({ type: 'SET_SELECTED_DIVISION', payload: id }),
    setSelectedAgent: (agent) => dispatch({ type: 'SET_SELECTED_AGENT', payload: agent }),
    setSearchQuery: (query) => dispatch({ type: 'SET_SEARCH_QUERY', payload: query }),
    addToTeam: (agent) => dispatch({ type: 'ADD_TO_TEAM', payload: agent }),
    removeFromTeam: (agentId) => dispatch({ type: 'REMOVE_FROM_TEAM', payload: agentId }),
    clearTeam: () => dispatch({ type: 'CLEAR_TEAM' }),
    setViewMode: (mode) => dispatch({ type: 'SET_VIEW_MODE', payload: mode }),
    setActivePanel: (panel) => dispatch({ type: 'SET_ACTIVE_PANEL', payload: panel }),
  }

  return React.createElement(StoreContext.Provider, { value }, children)
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) {
    throw new Error('useStore must be used within a StoreProvider')
  }
  return ctx
}

export default useStore
