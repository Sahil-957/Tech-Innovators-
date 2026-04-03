import { useEffect, useRef, useState } from 'react'

const MAX_DELAY = 10000

export function useWebSocket(url) {
  const [data, setData] = useState({})
  const [status, setStatus] = useState('connecting')
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const reconnectTimerRef = useRef(null)
  const attemptsRef = useRef(0)

  useEffect(() => {
    let socket
    let isActive = true

    const connect = () => {
      if (!isActive) return

      setStatus('connecting')
      socket = new WebSocket(url)

      socket.onopen = () => {
        attemptsRef.current = 0
        setError('')
        setStatus('connected')
      }

      socket.onmessage = (event) => {
        try {
          const nextData = JSON.parse(event.data)
          setData(nextData)
          setLastUpdated(Date.now())
          setStatus('connected')
        } catch {
          setError('Received invalid live data.')
        }
      }

      socket.onerror = () => {
        setError('Unable to read from the WebSocket server.')
      }

      socket.onclose = () => {
        if (!isActive) return

        setStatus('disconnected')
        attemptsRef.current += 1
        const delay = Math.min(1000 * 2 ** (attemptsRef.current - 1), MAX_DELAY)
        reconnectTimerRef.current = window.setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      isActive = false

      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
      }

      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close()
      }
    }
  }, [url])

  return { data, status, error, lastUpdated }
}
