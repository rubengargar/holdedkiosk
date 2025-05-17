const WORKER_BASE = import.meta.env.VITE_WORKER_BASE

export async function getEmployees(): Promise<any[]> {
  const token = localStorage.getItem('holded_token')
  if (!token) throw new Error('No token stored')

  const res = await fetch(`${WORKER_BASE}/api/employees`, {
    headers: {
      'X-Holded-API-Key': token
    }
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Error fetching employees: ${res.status} - ${text}`)
  }

  return res.json()
}

export async function getEmployeeTimes(employeeId: string) {
  const token = localStorage.getItem('holded_token')
  if (!token) throw new Error('No token stored')

  const res = await fetch(`${WORKER_BASE}/api/employees/${employeeId}/times`, {
    headers: {
      'X-Holded-API-Key': token
    }
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Error fetching employee times: ${res.status} - ${text}`)
  }

  return res.json()
}

export async function clockIn(employeeId: string) {
  const token = localStorage.getItem('holded_token')
  if (!token) throw new Error('No token stored')

  const res = await fetch(`${WORKER_BASE}/api/employees/${employeeId}/clockin`, {
    method: 'POST',
    headers: {
      'X-Holded-API-Key': token
    }
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Error clocking in: ${res.status} - ${text}`)
  }

  return res.json()
}

export async function clockOut(employeeId: string) {
  const token = localStorage.getItem('holded_token')
  if (!token) throw new Error('No token stored')

  const res = await fetch(`${WORKER_BASE}/api/employees/${employeeId}/clockout`, {
    method: 'POST',
    headers: {
      'X-Holded-API-Key': token
    }
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Error clocking out: ${res.status} - ${text}`)
  }

  return res.json()
}