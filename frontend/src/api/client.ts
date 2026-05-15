import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// Auth
export const login = (username: string, password: string) => {
  const form = new URLSearchParams()
  form.append('username', username)
  form.append('password', password)
  return api.post('/auth/login', form)
}
export const register = (d: { username: string; email: string; full_name?: string; password: string }) =>
  api.post('/auth/register', d)
export const getMe = () => api.get('/auth/me')

// Users
export const getUsers = () => api.get('/users')
export const createUser = (d: object) => api.post('/users', d)
export const updateUser = (id: number, d: object) => api.put(`/users/${id}`, d)
export const deleteUser = (id: number) => api.delete(`/users/${id}`)

// Email Accounts
export const getAccounts = () => api.get('/accounts')
export const createAccount = (d: object) => api.post('/accounts', d)
export const updateAccount = (id: number, d: object) => api.put(`/accounts/${id}`, d)
export const deleteAccount = (id: number) => api.delete(`/accounts/${id}`)
export const testAccount = (id: number) => api.post(`/accounts/${id}/test`)
export const fetchAccount = (id: number) => api.post(`/accounts/${id}/fetch`)
export const fetchAccountAll = (id: number) => api.post(`/accounts/${id}/fetch?reset=true`)

// Labels
export const getLabels = () => api.get('/labels')
export const createLabel = (d: object) => api.post('/labels', d)
export const updateLabel = (id: number, d: object) => api.put(`/labels/${id}`, d)
export const deleteLabel = (id: number) => api.delete(`/labels/${id}`)

// Forwarding Rules
export const getForwardingRules = () => api.get('/forwarding')
export const createForwardingRule = (d: object) => api.post('/forwarding', d)
export const updateForwardingRule = (id: number, d: object) => api.put(`/forwarding/${id}`, d)
export const deleteForwardingRule = (id: number) => api.delete(`/forwarding/${id}`)
export const toggleForwardingRule = (id: number) => api.post(`/forwarding/${id}/toggle`)

// Emails
export const getEmails = (params: object) => api.get('/emails', { params })
export const getEmailStats = () => api.get('/emails/stats')
export const getEmail = (id: number) => api.get(`/emails/${id}`)
export const updateEmailStatus = (id: number, d: object) => api.put(`/emails/${id}/status`, d)
export const confirmEmail = (id: number) => api.post(`/emails/${id}/confirm`)
export const setEmailLabels = (id: number, label_ids: number[]) => api.post(`/emails/${id}/labels`, { label_ids })
export const reanalyzeEmail = (id: number) => api.post(`/emails/${id}/analyze`)
export const refetchEmailBody = (id: number) => api.post(`/emails/${id}/refetch`)
export const analyzeAllEmails = (params?: object) => api.post('/emails/analyze-all', null, { params })
export const forwardEmail = (id: number) => api.post(`/emails/${id}/forward`)
export const getEmailActivities = (id: number) => api.get(`/emails/${id}/activities`)
export const getEmailAttachments = (id: number) => api.get(`/emails/${id}/attachments`)
export const prefetchAttachments = (id: number) => api.post(`/emails/${id}/prefetch-attachments`)
export const getRelatedEmails = (id: number) => api.get(`/emails/${id}/related`)
export const downloadAttachment = async (emailId: number, attachmentId: number, filename: string) => {
  const token = localStorage.getItem('token')
  const url = `/api/emails/${emailId}/attachments/${attachmentId}/download`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    let msg = 'ダウンロードに失敗しました'
    try { const j = await res.json(); msg = j.detail || msg } catch {}
    throw new Error(msg)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  a.click()
  URL.revokeObjectURL(objectUrl)
}

// Reply Templates
export const getReplyTemplates = () => api.get('/reply/templates')
export const createReplyTemplate = (d: object) => api.post('/reply/templates', d)
export const updateReplyTemplate = (id: number, d: object) => api.put(`/reply/templates/${id}`, d)
export const deleteReplyTemplate = (id: number) => api.delete(`/reply/templates/${id}`)
export const sendReply = (d: object) => api.post('/reply/send', d)
export const getReplyLogs = (emailId: number) => api.get(`/reply/logs/${emailId}`)
export const getReplyTags = () => api.get('/reply/tags')

// Documents
export const analyzeSchedule = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/documents/analyze-schedule', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    responseType: 'blob',
  })
}

// CSV
export const getCsvUploads = () => api.get('/csv')
export const uploadCsv = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/csv/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
}
export const deleteCsvUpload = (id: number) => api.delete(`/csv/${id}`)
export const rematchCsv = (id: number) => api.post(`/csv/${id}/rematch`)

// Archives
export const getEmailArchives = (emailId: number) => api.get(`/archives/email/${emailId}`)
export const retryArchiveExtraction = (archiveId: number) => api.post(`/archives/${archiveId}/retry`)
export const downloadExtractedFile = async (archiveId: number, fileId: number, filename: string) => {
  const token = localStorage.getItem('token')
  const url = `/api/archives/${archiveId}/files/${fileId}/download`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    let msg = 'ダウンロードに失敗しました'
    try { const j = await res.json(); msg = j.detail || msg } catch {}
    throw new Error(msg)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  a.click()
  URL.revokeObjectURL(objectUrl)
}

export default api
