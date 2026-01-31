import { useState, useCallback, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

import { KanbanColumn } from './KanbanColumn'
import { TaskCard } from './TaskCard'
import type { Task, TaskStatus, AsanaSection } from '../../types'

// Default columns when no Asana sections are available
const DEFAULT_COLUMNS: AsanaSection[] = [
  { gid: 'todo', name: 'To Do', position: 0 },
  { gid: 'in_progress', name: 'In Progress', position: 1 },
  { gid: 'review', name: 'Review', position: 2 },
  { gid: 'done', name: 'Done', position: 3 },
]

interface KanbanBoardProps {
  tasks: Task[]
  sections?: AsanaSection[]
  onTaskMove: (taskId: string, newStatus: TaskStatus, sectionGid?: string, sectionName?: string) => void
  onTaskClick?: (task: Task) => void
  onTaskEdit?: (task: Task) => void
}

export function KanbanBoard({ tasks, sections, onTaskMove, onTaskClick, onTaskEdit }: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  // Use provided sections or default columns
  const columns = useMemo(() => {
    if (sections && sections.length > 0) {
      return sections
    }
    return DEFAULT_COLUMNS
  }, [sections])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Get tasks by section - matches by section_name or falls back to status for legacy tasks
  const getTasksBySection = useCallback(
    (sectionGid: string, sectionName: string) => {
      return tasks.filter((task) => {
        // First try to match by section_name (Asana synced tasks)
        if (task.section_name) {
          return task.section_name === sectionName
        }
        // Fall back to status matching for legacy tasks
        // Map section names to status if no section_name set
        const statusMap: Record<string, TaskStatus[]> = {
          'To Do': ['todo'],
          'In Progress': ['in_progress'],
          'Review': ['review'],
          'Done': ['done'],
        }
        const matchingStatuses = statusMap[sectionName]
        if (matchingStatuses) {
          return matchingStatuses.includes(task.status)
        }
        // For custom Asana sections, check if gid matches
        return task.asana_section_gid === sectionGid
      })
    },
    [tasks]
  )

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const task = tasks.find((t) => t.id === active.id)
    if (task) {
      setActiveTask(task)
    }
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    const activeTask = tasks.find((t) => t.id === activeId)
    if (!activeTask) return

    // Check if we're over a column (section)
    const overColumn = columns.find((col) => col.gid === overId)
    if (overColumn) {
      const currentSection = activeTask.section_name || activeTask.status
      if (currentSection !== overColumn.name) {
        // Map section name to status for backward compatibility
        const newStatus = mapSectionToStatus(overColumn.name)
        onTaskMove(activeId, newStatus, overColumn.gid, overColumn.name)
      }
      return
    }

    // Check if we're over another task
    const overTask = tasks.find((t) => t.id === overId)
    if (overTask) {
      const overSection = overTask.section_name || overTask.status
      const activeSection = activeTask.section_name || activeTask.status
      if (activeSection !== overSection) {
        const newStatus = mapSectionToStatus(overSection)
        const sectionGid = overTask.asana_section_gid || overTask.status
        onTaskMove(activeId, newStatus, sectionGid, overSection)
      }
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)

    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    const activeTask = tasks.find((t) => t.id === activeId)
    if (!activeTask) return

    // If dropped on a column (section)
    const overColumn = columns.find((col) => col.gid === overId)
    if (overColumn) {
      const currentSection = activeTask.section_name || activeTask.status
      if (currentSection !== overColumn.name) {
        const newStatus = mapSectionToStatus(overColumn.name)
        onTaskMove(activeId, newStatus, overColumn.gid, overColumn.name)
      }
    }
  }

  return (
    <div className="kanban-board">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="kanban-columns">
          {columns.map((column) => {
            const columnTasks = getTasksBySection(column.gid, column.name)
            return (
              <KanbanColumn
                key={column.gid}
                id={column.gid}
                title={column.name}
                tasks={columnTasks}
                position={column.position}
                onTaskClick={onTaskClick}
                onTaskEdit={onTaskEdit}
              />
            )
          })}
        </div>

        <DragOverlay>
          {activeTask ? (
            <TaskCard task={activeTask} isDragging />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

// Helper function to map section names to legacy status values
function mapSectionToStatus(sectionName: string): TaskStatus {
  const name = sectionName.toLowerCase()
  if (name.includes('done') || name.includes('complete')) {
    return 'done'
  }
  if (name.includes('progress') || name.includes('doing') || name.includes('working')) {
    return 'in_progress'
  }
  if (name.includes('review') || name.includes('testing') || name.includes('qa')) {
    return 'review'
  }
  // Default to todo for anything else (including "To Do", "Backlog", etc.)
  return 'todo'
}
