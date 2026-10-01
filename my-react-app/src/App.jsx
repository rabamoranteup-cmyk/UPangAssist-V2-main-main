import { useState, useEffect, useRef } from 'react'
import upangLogo from './assets/upang logo.png'
import campusPhoto from './assets/UpangCampus.jpg'
import './Landing.css'
import './App.css'
import { apiBaseUrl, apiRequest } from './utils/apiBaseUrl'
import AdminKnowledge from './AdminKnowledge'

const quickPrompts = [
  "Where is the Registrar's Office?",
  'Where can I pay my tuition?',
  'How can I apply for a scholarship?',
  'Where are the campus buildings located?',
]

let nextUniqueId = 1000
function getNextId(prefix = 'item') {
  nextUniqueId += 1
  return `${prefix}_${nextUniqueId}`
}

export default function App() {
  const [view, setView] = useState('assistant')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [isTyping, setIsTyping] = useState(false)
  const [chatNotice, setChatNotice] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeHistoryId, setActiveHistoryId] = useState(null)
  const [historyList, setHistoryList] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [editingHistoryId, setEditingHistoryId] = useState(null)
  const [historyTitleDraft, setHistoryTitleDraft] = useState('')
  const [conversationVersions, setConversationVersions] = useState([])
  const [showVersionsModal, setShowVersionsModal] = useState(false)
  const [versionModalMessageId, setVersionModalMessageId] = useState(null)
  const [versionModalPosition, setVersionModalPosition] = useState(0)
  const [versionModalTurn, setVersionModalTurn] = useState(null)
  const [versionModalVersions, setVersionModalVersions] = useState([])
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editedMessageDraft, setEditedMessageDraft] = useState('')

  const [currentUser, setCurrentUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  
  const chatEndRef = useRef(null)
  const inputRef = useRef(null)
  const streamBufferRef = useRef('')

  // Scroll to bottom when messages update
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isTyping])

  useEffect(() => {
  let cancelled = false

  async function restoreSession() {
      try {
        const data = await apiRequest('/auth/me')

        if (!cancelled) {
          setCurrentUser(data.user || null)
          const wantsAdmin = window.location.pathname === '/admin'
          if (wantsAdmin && data.user?.role !== 'admin') window.history.replaceState({}, '', '/')
          setView(data.user ? (wantsAdmin && data.user.role === 'admin' ? 'admin' : 'assistant') : 'home')
        }
      } catch {
        if (!cancelled) {
          setCurrentUser(null)
          setView(new URLSearchParams(window.location.search).has('oauth_error') ? 'login' : 'home')
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false)
        }
      }
    }

    restoreSession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const syncAdminRoute = () => {
      if (window.location.pathname === '/admin') {
        if (currentUser?.role === 'admin') setView('admin')
        else {
          window.history.replaceState({}, '', '/')
          setView(currentUser ? 'assistant' : 'home')
        }
      } else if (view === 'admin') setView(currentUser ? 'assistant' : 'home')
    }
    window.addEventListener('popstate', syncAdminRoute)
    return () => window.removeEventListener('popstate', syncAdminRoute)
  }, [currentUser, view])

  const openAdminPage = () => {
    if (currentUser?.role !== 'admin') return
    window.history.pushState({}, '', '/admin')
    setView('admin')
    setSidebarOpen(false)
  }
  const closeAdminPage = () => {
    window.history.pushState({}, '', '/')
    setView('assistant')
  }

  useEffect(() => {
    let cancelled = false
    if (!currentUser) {
      setHistoryList([])
      return undefined
    }
    setHistoryLoading(true)
    apiRequest('/conversations')
      .then((items) => { if (!cancelled) setHistoryList(items) })
      .catch((error) => { if (!cancelled) console.error('Unable to load conversation history:', error) })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    return () => { cancelled = true }
  }, [currentUser])

  useEffect(() => {
    if (!showLogoutConfirm) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !loggingOut) setShowLogoutConfirm(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showLogoutConfirm, loggingOut])

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await apiRequest('/auth/logout', {
        method: 'POST',
      })
    } finally {
      setCurrentUser(null)
      setMessages([])
      setHistoryList([])
      setActiveHistoryId(null)
      setView('login')
      setShowLogoutConfirm(false)
      setLoggingOut(false)
    }
  }

  const handleSendMessage = async (textToSend) => {
    const trimmed = (textToSend || input).trim()
    if (!trimmed || isTyping) return

    const userMessage = {
      id: getNextId('user_msg'),
      sender: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsTyping(true)
    setChatNotice('')

    const assistantMsgId = getNextId('asst_msg')
    const assistantTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    try {
      const response = await fetch(`${apiBaseUrl}/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: trimmed,
          stream: true,
          ...(activeHistoryId ? { conversationId: activeHistoryId } : {}),
        }),
      })

      const persistedConversationId = response.headers.get('X-Conversation-Id')
      if (persistedConversationId) setActiveHistoryId(persistedConversationId)

      if (response.status === 204) {
        setChatNotice('The database references do not support an answer to this question.')
        return
      }

      if (!response.ok) {
        throw new Error('Chat request failed')
      }

      const contentType = response.headers.get('content-type') || ''

      if (contentType.includes('application/json')) {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Chat request failed')
        if (data.conversationId) setActiveHistoryId(data.conversationId)
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            text: data.text,
            followUps: [],
            timestamp: assistantTimestamp,
          },
        ])
        setIsTyping(false)
      } else {
        // Stream text chunk-by-chunk for real-time typewriter display
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        streamBufferRef.current = ''

        // Create empty assistant bubble first
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            sender: 'assistant',
            text: '',
            followUps: [],
            timestamp: assistantTimestamp,
          },
        ])
        setIsTyping(false)

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const accumulatedText = streamBufferRef.current + decoder.decode(value, { stream: true })
          streamBufferRef.current = accumulatedText

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId ? { ...msg, text: accumulatedText } : msg
            )
          )
        }
      }
      if (persistedConversationId) {
        const [items, conversation] = await Promise.all([
          apiRequest('/conversations'),
          apiRequest(`/conversations/${persistedConversationId}`),
        ])
        setHistoryList(items)
        setConversationVersions(conversation.versions || [])
        setMessages(conversation.messages.map((message) => ({
          id: message._id,
          sender: message.role,
          text: message.content,
          followUps: [],
          timestamp: new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })))
      }
    } catch (err) {
      console.error('Chat error:', err)
      setChatNotice('Could not retrieve a database answer. Please try again.')
    } finally {
      setIsTyping(false)
    }
  }

  const handlePromptClick = (prompt) => {
    handleSendMessage(prompt)
  }

  const handleNewConversation = () => {
    setMessages([])
    setChatNotice('')
    setInput('')
    setActiveHistoryId(null)
    setConversationVersions([])
    setShowVersionsModal(false)
    setVersionModalTurn(null)
    setEditingMessageId(null)
    if (window.innerWidth <= 900) {
      setSidebarOpen(false)
    }
  }

  const handleSelectHistory = (item) => {
    setChatNotice('')
    setActiveHistoryId(item.id)
    setEditingMessageId(null)
    setShowVersionsModal(false)
    setMessages([])
    apiRequest(`/conversations/${item.id}`)
      .then((conversation) => {
        setConversationVersions(conversation.versions || [])
        setMessages(conversation.messages.map((message) => ({
          id: message._id,
          sender: message.role,
          text: message.content,
          followUps: [],
          timestamp: new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })))
      })
      .catch((error) => console.error('Unable to load conversation:', error))
    if (window.innerWidth <= 900) {
      setSidebarOpen(false)
    }
  }

  const getVersionedTurn = (savedMessages, messageId) => {
    const messageIndex = savedMessages.findIndex((message) => String(message._id) === messageId)
    if (messageIndex < 0) return null
    const userMessage = savedMessages[messageIndex]
    const assistantMessage = savedMessages[messageIndex + 1]
    if (userMessage.role !== 'user') return null
    return {
      user: userMessage.content,
      assistant: assistantMessage?.role === 'assistant' ? assistantMessage.content : '',
    }
  }

  const handleOpenMessageVersions = async (messageId) => {
    if (!activeHistoryId) return
    try {
      const current = await apiRequest(`/conversations/${activeHistoryId}?messageId=${messageId}`)
      setVersionModalVersions(current.versions || [])
      const versions = current.versions || []
      if (!versions.length) return
      const oldest = await apiRequest(`/conversations/${activeHistoryId}?messageId=${messageId}&version=1`)
      setVersionModalMessageId(messageId)
      setVersionModalPosition(0)
      setVersionModalTurn(getVersionedTurn(oldest.messages, messageId))
      setShowVersionsModal(true)
    } catch (error) {
      console.error('Unable to load message versions:', error)
    }
  }

  const handleChangeModalVersion = async (position) => {
    if (!activeHistoryId || !versionModalMessageId) return
    const versionPosition = Math.max(0, Math.min(position, versionModalVersions.length))
    const versionCount = versionModalVersions.length
    const apiVersion = versionPosition === versionCount ? 0 : versionPosition + 1
    try {
      const version = await apiRequest(`/conversations/${activeHistoryId}?messageId=${versionModalMessageId}&version=${apiVersion}`)
      setVersionModalPosition(versionPosition)
      setVersionModalTurn(getVersionedTurn(version.messages, versionModalMessageId))
    } catch (error) {
      console.error('Unable to open message version:', error)
    }
  }

  const handleEditConversationMessage = async (message) => {
    const content = editedMessageDraft.trim()
    setEditingMessageId(null)
    if (!content || content === message.text || !activeHistoryId) return
    setChatNotice('')
    setMessages((items) => {
      const editedIndex = items.findIndex((item) => item.id === message.id)
      if (editedIndex < 0) return items
      return [
        ...items.slice(0, editedIndex),
        { ...items[editedIndex], text: content },
      ]
    })
    setIsTyping(true)
    try {
      const conversation = await apiRequest(`/conversations/${activeHistoryId}/edit`, {
        method: 'POST',
        body: JSON.stringify({ messageId: message.id, content }),
      })
      if (!conversation) {
        setMessages((items) => items.map((item) => item.id === message.id ? { ...item, text: message.text } : item))
        setChatNotice('The database references do not support an answer to the edited question.')
        return
      }
      const withVersionMetadata = await apiRequest(`/conversations/${activeHistoryId}`)
      setMessages(conversation.messages.map((savedMessage) => ({
        id: savedMessage._id,
        sender: savedMessage.role,
        text: savedMessage.content,
        followUps: [],
        timestamp: new Date(savedMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      })))
      setConversationVersions(withVersionMetadata.versions || [])
      setHistoryList((items) => items.map((item) => item.id === activeHistoryId
        ? { ...item, title: conversation.title }
        : item))
    } catch (error) {
      console.error('Unable to edit conversation message:', error)
      setMessages((items) => items.map((item) => item.id === message.id ? { ...item, text: message.text } : item))
      setChatNotice('No database answer was generated for the edited question.')
    } finally {
      setIsTyping(false)
    }
  }

  const handleDeleteHistory = async (e, id) => {
    e.stopPropagation()
    try {
      await apiRequest(`/conversations/${id}`, { method: 'DELETE' })
      setHistoryList((prev) => prev.filter((item) => item.id !== id))
      if (activeHistoryId === id) handleNewConversation()
    } catch (error) {
      console.error('Unable to delete conversation:', error)
    }
  }

  const handleRenameHistory = async (id) => {
    const title = historyTitleDraft.trim()
    const previousTitle = historyList.find((item) => item.id === id)?.title
    setEditingHistoryId(null)
    if (!title || title === previousTitle) return
    try {
      const updated = await apiRequest(`/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      })
      setHistoryList((items) => items.map((item) => item.id === id ? { ...item, title: updated.title } : item))
    } catch (error) {
      console.error('Unable to rename conversation:', error)
      setHistoryTitleDraft(previousTitle || '')
    }
  }
  const latestUserMessageId = [...messages].reverse().find((message) => message.sender === 'user')?.id

  if (authLoading) {
    return (
      <main className="login-page">
        <section className="login-panel">
          <div className="login-content">
            <p>Checking your session...</p>
          </div>
        </section>
      </main>
    )
  }
  if (view === 'login') {
    return <LoginPage onLogin={(user) => { setCurrentUser(user); setView('assistant') }} onSignUp={() => setView('signup')} onForgotPassword={() => setView('forgot-password')} />
  }
  if (view === 'signup') {
    return <SignupPage onRegistered={(user) => { setCurrentUser(user); setView('assistant') }} onBack={() => setView('login')} />
  }
  if (view === 'forgot-password') {
    return <ForgotPasswordPage onBack={() => setView('login')} />
  }
  if (view === 'home') {
    return <LandingPage onLogin={() => setView('login')} onSignUp={() => setView('signup')} />
  }
  if (view === 'admin' && currentUser?.role === 'admin') {
    return <AdminKnowledge onBack={closeAdminPage} />
  }
  return (
    <div className="app-shell">
      {showLogoutConfirm && (
        <div className="logout-confirm-overlay" onClick={() => !loggingOut && setShowLogoutConfirm(false)}>
          <section
            className="logout-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="logout-confirm-title"
            aria-describedby="logout-confirm-message"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="logout-confirm-mark" aria-hidden="true">↗</span>
            <h2 id="logout-confirm-title">Log Out</h2>
            <p id="logout-confirm-message">Are you sure you want to log out?</p>
            <div className="logout-confirm-actions">
              <button className="logout-cancel-btn" type="button" onClick={() => setShowLogoutConfirm(false)} disabled={loggingOut}>Cancel</button>
              <button className="logout-accept-btn" type="button" onClick={handleLogout} disabled={loggingOut}>{loggingOut ? 'Logging Out…' : 'Log Out'}</button>
            </div>
          </section>
        </div>
      )}
      {/* Mobile Backdrop Overlay */}
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        {/* Brand Header */}
        <div className="brand" aria-label="Upang Assist brand">
          <div className="brand-badge">
            <img src={upangLogo} alt="PHINMA UPang Logo" className="brand-logo-img" />
          </div>
          <h1>Upang Assist</h1>
          <button
            className="sidebar-close-btn"
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            âœ•
          </button>
        </div>

        {/* New Conversation Button */}
        <button
          className="new-conversation"
          type="button"
          onClick={handleNewConversation}
        >
          <span className="plus">+</span>
          <span>New Conversation</span>
        </button>

        {/* History Section */}
        <div className="history-label">History</div>
        <ul className="history-list">
          {historyLoading && <li className="history-empty">Loading conversations...</li>}
          {!historyLoading && historyList.length === 0 && <li className="history-empty">No saved conversations yet</li>}
          {historyList.map((item) => (
            <li
              key={item.id}
              className={`history-item ${activeHistoryId === item.id ? 'active' : ''}`}
              onClick={() => handleSelectHistory(item)}
            >
              {editingHistoryId === item.id ? (
                <input
                  className="history-title-input"
                  aria-label="Conversation name"
                  autoFocus
                  maxLength={120}
                  value={historyTitleDraft}
                  onChange={(event) => setHistoryTitleDraft(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={() => handleRenameHistory(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') {
                      setHistoryTitleDraft(item.title)
                      setEditingHistoryId(null)
                    }
                  }}
                />
              ) : (
                <span
                  className="history-title"
                  title="Double-click to rename"
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    setHistoryTitleDraft(item.title)
                    setEditingHistoryId(item.id)
                  }}
                >
                  {item.title}
                </span>
              )}
              <button
                type="button"
                className="history-delete-btn"
                onClick={(e) => handleDeleteHistory(e, item.id)}
                title="Delete conversation"
                aria-label="Delete item"
              >
                âœ•
              </button>
            </li>
          ))}
        </ul>

        {/* Sidebar Links & Log In */}
        <div className="sidebar-links">
          <span>Help</span>
          <span>Settings</span>
        </div>

        {currentUser?.role === 'admin' && (
          <button className="new-conversation" type="button" onClick={openAdminPage}>
            <span aria-hidden="true">⚙</span><span>Manage Knowledge</span>
          </button>
        )}

        {currentUser ? (
          <section className="sidebar-profile" aria-label="Signed-in profile">
            <div className="sidebar-profile-heading">My Profile</div>
            <div className="sidebar-profile-card">
              <div className="profile-avatar" aria-hidden="true">
                {(currentUser.name || currentUser.email || 'U')
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join('')
                  .toUpperCase()}
              </div>
              <div className="profile-details">
                <strong title={currentUser.name}>{currentUser.name}</strong>
                <span title={currentUser.email}>{currentUser.email}</span>
                {currentUser.course && <small title={currentUser.course}>{currentUser.course}</small>}
              </div>
            </div>
            <button className="login-btn" type="button" onClick={() => setShowLogoutConfirm(true)}>
              LOG OUT
            </button>
          </section>
        ) : (
          <button
            className="login-btn"
            type="button"
            onClick={() => setView('login')}
          >
            LOG IN
          </button>
        )}
      </aside>

      {/* Main Panel */}
      <main className="main-panel">
        {/* Top Header Bar */}
        <header className="main-topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-trigger"
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>

            <div className="campus-badge">
              <span className="status-dot" aria-hidden="true"></span>
              <span className="status-text">Si Apple to</span>
            </div>
          </div>

          <div className="topbar-right">
            {messages.length > 0 && (
              <button
                className="reset-chat-btn"
                type="button"
                onClick={handleNewConversation}
                title="Start a new conversation"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                  <path d="M21 3v5h-5"></path>
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                  <path d="M8 16H3v5"></path>
                </svg>
                <span>Clear Chat</span>
              </button>
            )}
          </div>
        </header>

        {/* Content Area: Welcome Center Screen OR Chat Thread */}
        <div className="main-content-scroll">
          {messages.length === 0 ? (
            <div className="welcome-center">
              <div className="hero-emblem-badge">
                <img src={upangLogo} alt="UPang Torch" className="hero-torch-img" />
              </div>

              <header className="welcome-block">
                <h2>
                  Welcome to <span>Upang Assist</span>
                </h2>
                <p className="welcome-tagline">What can I help you today?</p>
              </header>

              <form
                className="prompt-box"
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSendMessage()
                }}
              >
                <span className="prompt-plus" aria-hidden="true">+</span>
                <input
                  ref={inputRef}
                  className="prompt-input"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask Anything"
                  aria-label="Ask a question"
                />
                {input && (
                  <button
                    type="button"
                    className="prompt-clear-btn"
                    onClick={() => setInput('')}
                    aria-label="Clear input text"
                  >
                    âœ•
                  </button>
                )}
                <button
                  className={`send-btn ${input.trim() ? 'send-btn-active' : ''}`}
                  type="submit"
                  aria-label="Send message"
                  disabled={!input.trim() || isTyping}
                >
                  <span className="send-arrow" aria-hidden="true">â†’</span>
                </button>
              </form>

              <div className="suggestion-list">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="suggestion-item"
                    onClick={() => handlePromptClick(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-thread">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`message-row ${msg.sender === 'user' ? 'message-user' : 'message-assistant'}`}
                >
                  {msg.sender === 'assistant' && (
                    <div className="message-avatar" aria-hidden="true">
                      <img src={upangLogo} alt="UPang Assistant" className="avatar-torch" />
                    </div>
                  )}

                  <div className="message-bubble-wrap">
                    <div className="message-meta">
                      <span className="sender-name">
                        {msg.sender === 'user' ? 'You' : 'Upang Assistant'}
                      </span>
                      <span className="message-time">{msg.timestamp}</span>
                    </div>

                    <div className="message-bubble">
                      {editingMessageId === msg.id ? (
                        <form className="edit-message-form" onSubmit={(event) => { event.preventDefault(); handleEditConversationMessage(msg) }}>
                          <textarea
                            autoFocus
                            value={editedMessageDraft}
                            maxLength={12000}
                            onChange={(event) => setEditedMessageDraft(event.target.value)}
                            aria-label="Edit your message"
                          />
                          <div className="edit-message-actions">
                            <button type="button" onClick={() => setEditingMessageId(null)}>Cancel</button>
                            <button type="submit" disabled={!editedMessageDraft.trim() || isTyping}>Save and regenerate</button>
                          </div>
                        </form>
                      ) : msg.sender === 'assistant' ? (
                        <div
                          className="formatted-content"
                          dangerouslySetInnerHTML={{
                            __html: formatMarkdown(msg.text),
                          }}
                        />
                      ) : (
                        <p>{msg.text}</p>
                      )}
                    </div>

                    <div className="message-action-row">
                      {msg.sender === 'user' && msg.id === latestUserMessageId && activeHistoryId && /^[a-f\d]{24}$/i.test(msg.id) && editingMessageId !== msg.id && (
                        <button
                          type="button"
                          className="message-icon-button"
                          title="Edit message"
                          aria-label="Edit message"
                          onClick={() => { setEditedMessageDraft(msg.text); setEditingMessageId(msg.id) }}
                          disabled={isTyping}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>
                        </button>
                      )}
                      {msg.sender === 'user' && activeHistoryId && conversationVersions.some((version) => version.editedMessageId === msg.id) && (
                        <button
                          type="button"
                          className="message-icon-button"
                          title="View message versions"
                          aria-label="View message versions"
                          onClick={() => handleOpenMessageVersions(msg.id)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
                        </button>
                      )}
                    </div>

                    {msg.followUps && msg.followUps.length > 0 && (
                      <div className="followup-chips">
                        {msg.followUps.map((chip) => (
                          <button
                            key={chip}
                            type="button"
                            className="followup-chip-btn"
                            onClick={() => handleSendMessage(chip)}
                          >
                            <span>{chip}</span>
                            <span className="chip-plus">+</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {msg.sender === 'user' && (
                    <div className="user-avatar-bubble" aria-hidden="true">
                      <span>U</span>
                    </div>
                  )}
                </div>
              ))}

              {isTyping && (
                <div className="message-row message-assistant">
                  <div className="message-avatar" aria-hidden="true">
                    <img src={upangLogo} alt="UPang Assistant" className="avatar-torch" />
                  </div>
                  <div className="message-bubble-wrap">
                    <div className="typing-indicator">
                      <span className="typing-dot"></span>
                      <span className="typing-dot"></span>
                      <span className="typing-dot"></span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {showVersionsModal && (
          <div className="versions-modal-backdrop" onClick={() => setShowVersionsModal(false)}>
            <section
              className="versions-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="versions-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="versions-modal-header">
                <div className="versions-modal-controls">
                  <button type="button" onClick={() => handleChangeModalVersion(versionModalPosition - 1)} disabled={versionModalPosition <= 0} aria-label="Previous version">‹</button>
                  <h2 id="versions-modal-title">Version {versionModalPosition + 1}</h2>
                  <button type="button" onClick={() => handleChangeModalVersion(versionModalPosition + 1)} disabled={versionModalPosition >= versionModalVersions.length} aria-label="Next version">›</button>
                </div>
                <button className="versions-modal-close" type="button" onClick={() => setShowVersionsModal(false)} aria-label="Close versions">×</button>
              </header>
              {versionModalTurn ? (
                <div className="version-preview-thread">
                  <div className="version-preview-user">{versionModalTurn.user}</div>
                  {versionModalTurn.assistant && <div className="version-preview-assistant">{versionModalTurn.assistant}</div>}
                </div>
              ) : <p className="version-preview-empty">This version could not be loaded.</p>}
            </section>
          </div>
        )}

        {/* Docked Prompt Box for ongoing chat */}
        {messages.length > 0 && (
          <div className="chat-composer-wrap">
            {chatNotice && <p className="chat-source-notice" role="status">{chatNotice}</p>}
            <form
              className="prompt-box prompt-box-docked"
              onSubmit={(e) => {
                e.preventDefault()
                handleSendMessage()
              }}
            >
              <span className="prompt-plus" aria-hidden="true">+</span>
              <input
                ref={inputRef}
                className="prompt-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Anything"
                aria-label="Ask a question"
              />
              {input && (
                <button
                  type="button"
                  className="prompt-clear-btn"
                  onClick={() => setInput('')}
                  aria-label="Clear input text"
                >
                  âœ•
                </button>
              )}
              <button
                className={`send-btn ${input.trim() ? 'send-btn-active' : ''}`}
                type="submit"
                aria-label="Send message"
                disabled={!input.trim() || isTyping}
              >
                <span className="send-arrow" aria-hidden="true">â†’</span>
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}

// Markdown formatter for clean assistant text display
function formatMarkdown(text) {
  if (!text) return ''

  let formatted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>')

  const lines = formatted.split('\n')
  let inList = false
  let result = []

  for (let line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('â€¢ ') || trimmed.startsWith('- ')) {
      if (!inList) {
        result.push('<ul class="chat-md-list">')
        inList = true
      }
      result.push(`<li>${trimmed.substring(2)}</li>`)
    } else {
      if (inList) {
        result.push('</ul>')
        inList = false
      }
      if (trimmed === '') {
        result.push('<div class="chat-md-gap"></div>')
      } else {
        result.push(`<p class="chat-md-p">${line}</p>`)
      }
    }
  }

  if (inList) {
    result.push('</ul>')
  }

  return result.join('')
}

function LoginPage({ onLogin, onSignUp, onForgotPassword }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [oauthError] = useState(() => {
    const code = new URLSearchParams(window.location.search).get('oauth_error')
    const messages = {
      google_not_configured: 'Google sign-in is not configured yet.',
      google_cancelled: 'Google sign-in was cancelled.',
      google_org_restricted: 'Google Workspace blocked this app for the selected account.',
      google_state_invalid: 'Google sign-in could not be verified. Please try again.',
      google_unverified: 'Google could not verify this account.',
      google_account_unregistered: 'This Google account is not registered in UPang Assist.',
      google_failed: 'Google sign-in failed. Please try again.',
    }
    return messages[code] || ''
  })
  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const data = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      onLogin(data.user)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <main className="login-page">
      <section className="login-visual" aria-label="University campus"><div className="login-visual-overlay"></div><div className="login-visual-copy"><div className="visual-emblem-badge"><img src={upangLogo} alt="PHINMA UPang Logo" className="visual-logo-img" /></div><span>PHINMA</span><strong>University of Pangasinan</strong></div></section>
      <section className="login-panel"><div className="login-content">
        <p className="login-kicker">WELCOME!</p><h1>To <span>Upang Assist</span></h1><h2>Log In</h2>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="login-email">School Email Address:</label><div className="input-with-icon"><input id="login-email" type="email" placeholder="student@your-school-domain.edu.ph" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
          <label htmlFor="login-password">Password:</label><div className="input-with-icon"><input id="login-password" type={showPassword ? 'text' : 'password'} placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" className="password-toggle-btn" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></div><button className="forgot-link forgot-link-below" type="button" onClick={onForgotPassword}>Forgot password?</button>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="login-submit" type="submit" disabled={submitting}>{submitting ? 'LOGGING IN...' : 'LOG IN'}</button>
          <button className="google-signin-btn" type="button" onClick={() => window.location.assign(`${apiBaseUrl}/auth/google`)}><svg className="google-signin-icon" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.7c3.9-3.6 6-8.8 6-15Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.7-5.1c-1.8 1.2-4 2-6.8 2-5.2 0-9.6-3.5-11.2-8.2H5.9v5.2A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.8 27.8a12 12 0 0 1 0-7.6V15H5.9a20 20 0 0 0 0 18l6.9-5.2Z"/><path fill="#EA4335" d="M24 12.1c3 0 5.6 1 7.7 3l5.8-5.8A19.3 19.3 0 0 0 24 4 20 20 0 0 0 5.9 15l6.9 5.2c1.6-4.7 6-8.1 11.2-8.1Z"/></svg><span>Sign in with Google</span></button>
        </form>
        {oauthError && <p className="login-error" role="alert">{oauthError}</p>}
        <p className="login-footer">Do not have an account? <button type="button" onClick={onSignUp}>Sign Up</button></p>
      </div></section>
    </main>
  )
}

function ForgotPasswordPage({ onBack }) {
  const [email, setEmail] = useState('')
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [challenge, setChallenge] = useState(() => makeRecoveryChallenge())
  const [step, setStep] = useState('email')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [feedbackType, setFeedbackType] = useState('')
  function refreshChallenge() {
    setChallenge(makeRecoveryChallenge())
    setCaptchaAnswer('')
    setMessage('')
    setFeedbackType('')
  }
  async function handleRequestOtp(event) {
    event.preventDefault()
    if (Number(captchaAnswer) !== challenge.answer) {
      setMessage('Please solve the verification question correctly.')
      setFeedbackType('error')
      return
    }
    setSubmitting(true)
    setMessage('')
    try {
      const result = await apiRequest('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })
      setMessage(result.message)
      setFeedbackType('info')
      setStep('otp')
    } catch (error) {
      setMessage(error.message)
      setFeedbackType('error')
    } finally {
      setSubmitting(false)
    }
  }
  async function handleVerifyOtp(event) {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    try {
      const result = await apiRequest('/auth/verify-reset-otp', { method: 'POST', body: JSON.stringify({ email, otp }) })
      setResetToken(result.resetToken)
      setStep('password')
      setFeedbackType('')
    } catch (error) {
      setMessage(error.message)
      setFeedbackType('error')
    } finally {
      setSubmitting(false)
    }
  }
  async function handleResetPassword(event) {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    try {
      const result = await apiRequest('/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, resetToken, password, confirmPassword }) })
      setMessage(result.message)
      setStep('complete')
      setFeedbackType('info')
    } catch (error) {
      setMessage(error.message)
      setFeedbackType('error')
    } finally {
      setSubmitting(false)
    }
  }
  function handleCancel() {
    setEmail('')
    setOtp('')
    setPassword('')
    setConfirmPassword('')
    setResetToken('')
    setStep('email')
    setMessage('')
    setFeedbackType('')
    refreshChallenge()
  }
  return (
    <main className="login-page recovery-login-page">
      <section className="login-visual" aria-label="University campus"><div className="login-visual-overlay"></div><div className="login-visual-copy"><div className="visual-emblem-badge"><img src={upangLogo} alt="PHINMA UPang Logo" className="visual-logo-img" /></div><span>PHINMA</span><strong>University of Pangasinan</strong></div></section>
      <section className="login-panel"><button className="login-back-btn" type="button" onClick={onBack}><span className="back-arrow">←</span><span>Back to Login</span></button><div className="login-content recovery-content">
        <p className="login-kicker">ACCOUNT HELP</p><h1>To <span>Upang Assist</span></h1><h2>Forgot Password?</h2>
        <p className="recovery-copy">{step === 'email' ? 'Enter your registered PHINMA email to request a one-time password.' : step === 'otp' ? `Enter the six-digit code sent to ${email}.` : step === 'password' ? 'Choose a new password for your account.' : 'Your password has been updated.'}</p>
        {step === 'email' && <form className="login-form recovery-form" onSubmit={handleRequestOtp}>
          <label htmlFor="recovery-email">Enter Registered PHINMA Email</label><div className="input-with-icon"><input id="recovery-email" type="email" placeholder="name@phinmaed.com" value={email} onChange={(event) => { setEmail(event.target.value); setMessage(''); setFeedbackType('') }} required /></div>
          <div className="recovery-challenge" aria-label="Email verification question">
            <output>{challenge.first}</output><span>+</span><output>{challenge.second}</output><span>=</span>
            <input aria-label="Answer to verification question" inputMode="numeric" pattern="[0-9]*" value={captchaAnswer} onChange={(event) => { setCaptchaAnswer(event.target.value); setMessage(''); setFeedbackType('') }} required />
            <button className="challenge-refresh" type="button" aria-label="Refresh verification question" onClick={refreshChallenge}>↻</button>
          </div>
          {message && <p className={`recovery-feedback recovery-feedback-${feedbackType}`} role={feedbackType === 'error' ? 'alert' : 'status'}>{message}</p>}
          <div className="recovery-actions"><button type="submit" className="login-submit" disabled={submitting}>{submitting ? 'SENDING...' : 'SEND OTP'}</button><button type="button" className="recovery-cancel-btn" onClick={handleCancel}>Cancel</button></div>
        </form>}
        {step === 'otp' && <form className="login-form recovery-form" onSubmit={handleVerifyOtp}>
          <label htmlFor="recovery-otp">One-Time Password</label><div className="input-with-icon"><input id="recovery-otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="Enter 6-digit code" value={otp} onChange={(event) => { setOtp(event.target.value.replace(/\D/g, '').slice(0, 6)); setMessage(''); setFeedbackType('') }} required /></div>
          {message && <p className="recovery-feedback recovery-feedback-error" role="alert">{message}</p>}
          <div className="recovery-actions"><button type="submit" className="login-submit" disabled={submitting}>{submitting ? 'VERIFYING...' : 'VERIFY OTP'}</button><button type="button" className="recovery-cancel-btn" onClick={handleCancel}>Cancel</button></div>
        </form>}
        {step === 'password' && <form className="login-form recovery-form" onSubmit={handleResetPassword}>
          <label htmlFor="recovery-password">New Password</label><div className="input-with-icon"><input id="recovery-password" type="password" minLength={8} maxLength={128} autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={(event) => { setPassword(event.target.value); setMessage(''); setFeedbackType('') }} required /></div>
          <label htmlFor="recovery-confirm-password">Confirm New Password</label><div className="input-with-icon"><input id="recovery-confirm-password" type="password" minLength={8} maxLength={128} autoComplete="new-password" placeholder="Re-enter new password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setMessage(''); setFeedbackType('') }} required /></div>
          {message && <p className="recovery-feedback recovery-feedback-error" role="alert">{message}</p>}
          <div className="recovery-actions"><button type="submit" className="login-submit" disabled={submitting}>{submitting ? 'UPDATING...' : 'RESET PASSWORD'}</button><button type="button" className="recovery-cancel-btn" onClick={handleCancel}>Cancel</button></div>
        </form>}
        {step === 'complete' && <div className="recovery-complete"><p className="recovery-feedback recovery-feedback-info" role="status">{message}</p><button className="login-submit" type="button" onClick={onBack}>BACK TO SIGN IN</button></div>}
        {step !== 'complete' && <p className="login-footer"><button type="button" onClick={onBack}>Back to Sign In</button></p>}
      </div></section>
    </main>
  )
}

function makeRecoveryChallenge() {
  const first = Math.floor(Math.random() * 20) + 1
  const second = Math.floor(Math.random() * 9) + 1
  return { first, second, answer: first + second }
}

function SignupPage({ onBack, onRegistered }) {
  const [form, setForm] = useState({ name: '', email: '', course: '', password: '', confirmPassword: '' })
  const [step, setStep] = useState('details')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const handleChange = (event) => { const { name, value } = event.target; setForm((current) => ({ ...current, [name]: value })) }
  const handleSubmit = async (event) => {
    event.preventDefault(); setError(''); setSubmitting(true)
    try {
      await apiRequest('/auth/register/request-otp', { method: 'POST', body: JSON.stringify(form) })
      setStep('otp')
    }
    catch (requestError) { setError(requestError.message) }
    finally { setSubmitting(false) }
  }
  const handleVerifyOtp = async (event) => {
    event.preventDefault(); setError(''); setSubmitting(true)
    try {
      const verification = await apiRequest('/auth/register/verify-otp', { method: 'POST', body: JSON.stringify({ email: form.email, otp }) })
      const data = await apiRequest('/auth/register', { method: 'POST', body: JSON.stringify({ email: form.email, registrationToken: verification.registrationToken }) })
      onRegistered(data.user)
    } catch (requestError) { setError(requestError.message) }
    finally { setSubmitting(false) }
  }
  return (
    <main className="login-page signup-page">
      <section className="login-visual" aria-label="University campus"><div className="login-visual-overlay"></div><div className="login-visual-copy"><div className="visual-emblem-badge"><img src={upangLogo} alt="PHINMA UPang Logo" className="visual-logo-img" /></div><span>PHINMA</span><strong>University of Pangasinan</strong></div></section>
      <section className="login-panel"><button className="login-back-btn" type="button" onClick={onBack}><span className="back-arrow">←</span><span>Back to Login</span></button><div className="login-content signup-content">
        <p className="login-kicker">WELCOME!</p><h1>To <span>Upang Assist</span></h1><h2>{step === 'details' ? 'Create Account' : 'Verify Your Email'}</h2>
        {step === 'details' ? <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="signup-name">Full Name:</label><div className="input-with-icon"><input id="signup-name" name="name" value={form.name} onChange={handleChange} required /></div>
          <label htmlFor="signup-email">School Email Address:</label><div className="input-with-icon"><input id="signup-email" name="email" type="email" value={form.email} onChange={handleChange} required /></div>
          <label htmlFor="signup-course">Course:</label><div className="input-with-icon"><input id="signup-course" name="course" value={form.course} onChange={handleChange} required /></div>
          <label htmlFor="signup-password">Password:</label><div className="input-with-icon"><input id="signup-password" name="password" type="password" value={form.password} onChange={handleChange} minLength={8} required /></div>
          <label htmlFor="signup-confirm-password">Confirm Password:</label><div className="input-with-icon"><input id="signup-confirm-password" name="confirmPassword" type="password" value={form.confirmPassword} onChange={handleChange} minLength={8} required /></div>
          {error && <p className="login-error" role="alert">{error}</p>}<button className="login-submit signup-submit" type="submit" disabled={submitting}>{submitting ? 'SENDING CODE...' : 'CREATE ACCOUNT'}</button>
        </form> : <form className="login-form" onSubmit={handleVerifyOtp}>
          <p className="recovery-copy">Enter the six-digit code sent to {form.email}. Your account will be created after verification.</p>
          <label htmlFor="signup-otp">Email Verification Code:</label><div className="input-with-icon"><input id="signup-otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="Enter 6-digit code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></div>
          {error && <p className="login-error" role="alert">{error}</p>}<button className="login-submit signup-submit" type="submit" disabled={submitting}>{submitting ? 'VERIFYING...' : 'VERIFY EMAIL'}</button>
          <button className="signup-edit-btn" type="button" onClick={() => { setStep('details'); setError(''); setOtp('') }}>Edit account details</button>
        </form>}
        <p className="login-footer">Already have an account? <button type="button" onClick={onBack}>Log in</button></p>
      </div></section>
    </main>
  )
}
function LandingPage({ onLogin, onSignUp }) {
  const topics = [
    { number: '01', title: 'Campus & offices', copy: 'Find the right building, office, or service before you set off.', icon: 'âŒ–' },
    { number: '02', title: 'Enrollment', copy: 'Get a clearer picture of advising, registration, and your next steps.', icon: 'â†—' },
    { number: '03', title: 'Tuition & scholarships', copy: 'Explore payment channels, school fees, and scholarship guidance.', icon: 'â‚±' },
    { number: '04', title: 'Student support', copy: 'Know where to go for health, wellness, and everyday help.', icon: 'â™¡' },
  ]

  return (
    <main className="landing-page">
      <header className="landing-nav">
        <a className="landing-brand" href="#top" aria-label="UPang Assist home">
          <span className="landing-brand-mark"><img src={upangLogo} alt="" /></span>
          <span><strong>UPang Assist</strong><small>PHINMA University of Pangasinan</small></span>
        </a>
        <nav className="landing-links" aria-label="Main navigation">
          <a href="#how-it-helps">What you can ask</a>
          <a href="#about">About</a>
        </nav>
        <div className="landing-nav-actions">
          <button className="landing-login" onClick={onLogin}>Log in</button>
          <button className="landing-nav-cta" onClick={onSignUp}>Get started <span>â†—</span></button>
        </div>
      </header>

      <section className="landing-hero" id="top">
        <div className="landing-hero-copy">
          <div className="landing-eyebrow"><span></span> YOUR CAMPUS, A LITTLE CLOSER</div>
          <h1>University life,<br />with a <em>little less</em><br />figuring it out.</h1>
          <p className="landing-intro">A helpful place to start when you have a question about campus, enrollment, tuition, or student support at UPang.</p>
          <div className="landing-hero-actions">
            <button className="landing-primary" onClick={onSignUp}>Ask your first question <span>â†—</span></button>
            <button className="landing-secondary" onClick={onLogin}>I already have an account <span>â†’</span></button>
          </div>
          <div className="landing-trust"><span className="trust-emblem"><img src={upangLogo} alt="" /></span><span>Made for the UPang community<br /><strong>Here when you need a hand.</strong></span></div>
        </div>
        <div className="landing-hero-visual">
          <img className="landing-campus-photo" src={campusPhoto} alt="PHINMA University of Pangasinan campus" />
          <div className="landing-image-wash"></div>
          <div className="campus-label"><span className="campus-label-dot"></span><span>DAGUPAN CITY<small>YOUR CAMPUS COMPANION</small></span></div>
          <div className="chat-preview">
            <div className="chat-preview-top"><span className="chat-preview-avatar"><img src={upangLogo} alt="" /></span><span><strong>UPang Assist</strong><small>Here to help you find your way</small></span><i></i></div>
            <p className="chat-preview-question">Where can I get help with enrollment?</p>
            <div className="chat-preview-answer"><span className="answer-spark">âœ³</span><p>Start with your college advising office for your course plan. I can also help you find registration steps and where to go next.</p></div>
            <div className="chat-preview-bottom"><span>Ask about your campus</span><span className="chat-send">â†‘</span></div>
          </div>
          <span className="visual-note">A good place<br />to begin.</span>
        </div>
        <div className="hero-index"><span>01</span><span className="hero-index-line"></span><span>04</span></div>
      </section>

      <section className="landing-topics" id="how-it-helps">
        <div className="topics-heading"><div><span className="section-kicker">A HAND WITH THE EVERYDAY</span><h2>Whatâ€™s on your mind?</h2></div><p>From â€œwhere do I go?â€ to â€œwhat do I do next?â€â€”start with a question and find your next step.</p></div>
        <div className="topic-grid">{topics.map((topic) => <article className="topic-card" key={topic.number}><div className="topic-card-top"><span>{topic.number}</span><span className="topic-icon">{topic.icon}</span></div><h3>{topic.title}</h3><p>{topic.copy}</p><span className="topic-arrow">â†—</span></article>)}</div>
      </section>

      <section className="landing-quote" id="about"><span className="quote-mark">â€œ</span><div><p>Big campus, lots of questions.<br /><em>Start anywhere.</em></p><span>UPANG ASSIST Â· YOUR STUDENT SUPPORT COMPANION</span></div><button onClick={onLogin}>Letâ€™s get started <span>â†—</span></button></section>
      <footer className="landing-footer"><a className="landing-brand" href="#top"><span className="landing-brand-mark"><img src={upangLogo} alt="" /></span><span><strong>UPang Assist</strong><small>PHINMA University of Pangasinan</small></span></a><span>For the questions that come with campus life.</span><button onClick={onLogin}>Student log in â†—</button></footer>
    </main>
  )
}
