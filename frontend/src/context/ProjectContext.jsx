import { createContext, useContext, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import { useAuth } from './AuthContext'

const ProjectContext = createContext(null)

export function ProjectProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [projectId, setProjectIdState] = useState(
    () => localStorage.getItem('project_id') || null
  )

  // Load active projects list (used by switcher + project page).
  // Gated on auth so the first global fetch doesn't fire unauthenticated
  // (which would cache an auth error and require a manual refresh).
  const { data: projects = [], isLoading, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects').then(r => r.data),
    enabled: !authLoading && !!user,
  })

  const activeProject = projects.find(p => String(p.id) === String(projectId)) || null

  // If saved project no longer exists/active, clear it
  useEffect(() => {
    if (!isLoading && projectId && projects.length > 0 && !activeProject) {
      localStorage.removeItem('project_id')
      setProjectIdState(null)
    }
  }, [isLoading, projectId, projects.length, activeProject])

  function selectProject(id) {
    if (id === null || id === undefined) {
      localStorage.removeItem('project_id')
      setProjectIdState(null)
    } else {
      localStorage.setItem('project_id', String(id))
      setProjectIdState(String(id))
    }
  }

  return (
    <ProjectContext.Provider value={{
      projectId,
      activeProject,
      projects,
      isLoading,
      selectProject,
      refetchProjects: refetch,
    }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  return useContext(ProjectContext)
}
