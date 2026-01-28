import { useState, useEffect } from 'react'
import api from '../../services/api'
import type { Task } from '../../types'

interface CalendarViewProps {
  onDateSelect?: (date: Date, tasks: Task[]) => void
  selectedDate?: Date
}

interface DayStatus {
  status: 'green' | 'yellow' | 'red' | 'gray'
  count: number
  tasks?: Task[]
}

interface CalendarData {
  [day: string]: DayStatus
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export function CalendarView({ onDateSelect, selectedDate }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [calendarData, setCalendarData] = useState<CalendarData>({})
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Date | null>(selectedDate || null)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  useEffect(() => {
    fetchCalendarData()
  }, [year, month])

  const fetchCalendarData = async () => {
    try {
      setLoading(true)
      const response = await api.getCalendarData(year, month + 1)
      if (response.success && response.data) {
        // Convert the API response to our CalendarData format
        const data: CalendarData = {}
        const days = response.data.days || {}
        Object.entries(days).forEach(([day, info]) => {
          data[day] = {
            status: info.status as DayStatus['status'],
            count: parseInt(info.count, 10)
          }
        })
        setCalendarData(data)
      }
    } catch (err) {
      console.error('Error fetching calendar data:', err)
    } finally {
      setLoading(false)
    }
  }

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay()
  }

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1))
  }

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1))
  }

  const handleToday = () => {
    setCurrentDate(new Date())
    const today = new Date()
    setSelected(today)
    handleDayClick(today.getDate())
  }

  const handleDayClick = async (day: number) => {
    const clickedDate = new Date(year, month, day)
    setSelected(clickedDate)

    if (onDateSelect) {
      try {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const response = await api.getTasksByDate(dateStr)
        if (response.success && response.data) {
          onDateSelect(clickedDate, response.data)
        }
      } catch (err) {
        console.error('Error fetching tasks for date:', err)
        onDateSelect(clickedDate, [])
      }
    }
  }

  const isToday = (day: number) => {
    const today = new Date()
    return (
      today.getDate() === day &&
      today.getMonth() === month &&
      today.getFullYear() === year
    )
  }

  const isSelected = (day: number) => {
    if (!selected) return false
    return (
      selected.getDate() === day &&
      selected.getMonth() === month &&
      selected.getFullYear() === year
    )
  }

  const getStatusIndicator = (day: number) => {
    const dayData = calendarData[String(day)]
    if (!dayData || dayData.count === 0) return null

    const statusColors = {
      green: 'var(--color-success)',
      yellow: 'var(--color-warning)',
      red: 'var(--color-danger)',
      gray: 'var(--text-muted)'
    }

    return (
      <div
        className="day-indicator"
        style={{ backgroundColor: statusColors[dayData.status] }}
        title={`${dayData.count} task${dayData.count !== 1 ? 's' : ''}`}
      />
    )
  }

  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)

  // Generate calendar grid
  const calendarDays: (number | null)[] = []

  // Add empty cells for days before the first day of the month
  for (let i = 0; i < firstDay; i++) {
    calendarDays.push(null)
  }

  // Add days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day)
  }

  // Calculate weeks
  const weeks: (number | null)[][] = []
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7))
  }

  // Ensure last week has 7 days
  const lastWeek = weeks[weeks.length - 1]
  while (lastWeek.length < 7) {
    lastWeek.push(null)
  }

  return (
    <div className="calendar-view glass-card">
      <div className="calendar-header">
        <button className="calendar-nav" onClick={handlePrevMonth} aria-label="Previous month">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="calendar-title">
          <h2>{MONTHS[month]} {year}</h2>
          <button className="btn btn-ghost btn-sm" onClick={handleToday}>
            Today
          </button>
        </div>
        <button className="calendar-nav" onClick={handleNextMonth} aria-label="Next month">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="calendar-grid">
        <div className="calendar-weekdays">
          {DAYS.map(day => (
            <div key={day} className="weekday">{day}</div>
          ))}
        </div>

        <div className="calendar-days">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="calendar-week">
              {week.map((day, dayIndex) => (
                <div
                  key={`${weekIndex}-${dayIndex}`}
                  className={`calendar-day ${day === null ? 'empty' : ''} ${day && isToday(day) ? 'today' : ''} ${day && isSelected(day) ? 'selected' : ''}`}
                  onClick={() => day && handleDayClick(day)}
                >
                  {day !== null && (
                    <>
                      <span className="day-number">{day}</span>
                      {getStatusIndicator(day)}
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="calendar-legend">
        <div className="legend-item">
          <span className="legend-dot legend-green" />
          <span>All completed</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot legend-yellow" />
          <span>In progress</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot legend-red" />
          <span>Overdue/Blocked</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot legend-gray" />
          <span>Pending</span>
        </div>
      </div>

      {loading && (
        <div className="calendar-loading">
          <div className="loading-spinner" />
        </div>
      )}
    </div>
  )
}
