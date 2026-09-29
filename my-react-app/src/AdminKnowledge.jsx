import { useEffect, useState } from 'react'
import { apiRequest } from './utils/apiBaseUrl'
import './AdminKnowledge.css'

const blankEntry = { category: '', question: '', answer: '' }

export default function AdminKnowledge({ onBack }) {
  const [entries, setEntries] = useState([])
  const [draft, setDraft] = useState(blankEntry)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadEntries = async () => {
    setLoading(true)
    try { setEntries(await apiRequest('/admin/knowledge')) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let active = true
    apiRequest('/admin/knowledge')
      .then((items) => { if (active) setEntries(items) })
      .catch((err) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const updateDraft = (event) => setDraft((value) => ({ ...value, [event.target.name]: event.target.value }))
  const resetDraft = () => { setDraft(blankEntry); setEditingId(null) }
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      await apiRequest(editingId ? `/admin/knowledge/${editingId}` : '/admin/knowledge', {
        method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(draft),
      })
      resetDraft(); setNotice(editingId ? 'Knowledge entry updated.' : 'Knowledge entry added.')
      await loadEntries()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }
  const edit = (entry) => {
    setEditingId(entry._id)
    setDraft(Object.fromEntries(Object.keys(blankEntry).map((key) => [key, entry[key] || ''])))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const remove = async (entry) => {
    if (!window.confirm(`Delete “${entry.question}”?`)) return
    setError(''); setNotice('')
    try { await apiRequest(`/admin/knowledge/${entry._id}`, { method: 'DELETE' }); setNotice('Knowledge entry deleted.'); await loadEntries() }
    catch (err) { setError(err.message) }
  }
  const visible = entries.filter((entry) => `${entry.category} ${entry.question} ${entry.answer}`.toLowerCase().includes(search.toLowerCase()))

  return <main className="knowledge-admin">
    <header className="knowledge-admin-header"><div><span className="knowledge-eyebrow">UPANG ASSIST</span><h1>Chatbot knowledge</h1><p>Manage the verified information the assistant uses to answer questions.</p></div><button type="button" className="knowledge-back" onClick={onBack}>← Back to chat</button></header>
    {(error || notice) && <div className={`knowledge-feedback ${error ? 'is-error' : ''}`} role="status">{error || notice}</div>}
    <section className="knowledge-card">
      <h2>{editingId ? 'Edit entry' : 'Add an entry'}</h2>
      <form className="knowledge-form" onSubmit={submit}>
        <label>Category<input name="category" maxLength={100} required value={draft.category} onChange={updateDraft} placeholder="Enrollment" /></label>
        <label>Question or topic<input name="question" maxLength={500} required value={draft.question} onChange={updateDraft} placeholder="What steps do students follow to enroll?" /></label>
        <label className="knowledge-wide">Verified answer<textarea name="answer" maxLength={10000} required rows={5} value={draft.answer} onChange={updateDraft} placeholder="Enter the answer students should receive" /></label>
        <div className="knowledge-actions"><button className="knowledge-save" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add to knowledge base'}</button>{editingId && <button type="button" className="knowledge-cancel" onClick={resetDraft}>Cancel</button>}</div>
      </form>
    </section>
    <section className="knowledge-card knowledge-library"><div className="knowledge-library-header"><div><h2>Knowledge entries</h2><p>{entries.length} entries available to the chatbot</p></div><input aria-label="Search knowledge entries" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search entries" /></div>
      {loading ? <p>Loading knowledge…</p> : visible.length === 0 ? <p>No matching entries.</p> : <div className="knowledge-entry-list">{visible.map((entry) => <article className="knowledge-entry" key={entry._id}><div className="knowledge-entry-copy"><span>{entry.category}</span><h3>{entry.question}</h3><p>{entry.answer}</p></div><div className="knowledge-entry-actions"><button type="button" onClick={() => edit(entry)}>Edit</button><button type="button" onClick={() => remove(entry)}>Delete</button></div></article>)}</div>}
    </section>
  </main>
}
