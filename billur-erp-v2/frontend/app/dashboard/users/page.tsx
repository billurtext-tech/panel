"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { useAuth } from "@/lib/auth/auth-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Users as UsersIcon, Plus, Edit, Loader2, RefreshCw } from "lucide-react"
import { roleNeedsWorkerLink } from "@/lib/auth/roles"
import { UserDialog } from "@/components/users/user-dialog"

export default function UsersPage() {
  const { hasPermission } = useAuth()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<any>(null)

  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/api/users'),
  })
  const { data: roles = [] } = useQuery<any[]>({
    queryKey: ['roles'],
    queryFn: () => api.get('/api/users/_meta/roles'),
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <UsersIcon className="h-7 w-7" /> Foydalanuvchilar
          </h1>
          <p className="text-muted-foreground">Tizim foydalanuvchilari va rollar</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ['users'] })}>
            <RefreshCw className="mr-2 h-4 w-4" /> Yangilash
          </Button>
          {hasPermission('users.create') && (
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="mr-2 h-4 w-4" /> Yangi foydalanuvchi
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Foydalanuvchilar ro'yxati</CardTitle>
          <CardDescription>{data.length} ta foydalanuvchi</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
          ) : !data.length ? (
            <div className="text-center py-12 text-muted-foreground">Foydalanuvchi yo'q</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>F.I.O.</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Oxirgi kirish</TableHead>
                    <TableHead>Ishchi</TableHead>
                    <TableHead>Holat</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((u: any) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-mono text-sm">{u.username}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-xs">
                              {u.full_name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('') || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{u.full_name}</span>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{u.role_name_uz || u.role_id}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {u.last_login_at ? new Date(u.last_login_at).toLocaleString('uz-UZ', { hour12: false }) : '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {u.worker_id ? (
                          <Badge variant="outline" className="font-mono border-green-500 text-green-600">
                            {u.worker_code || "✓"}
                          </Badge>
                        ) : roleNeedsWorkerLink(u.role_id) ? (
                          <Badge variant="outline" className="border-amber-500 text-amber-600">Yo&apos;q</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {u.is_active ? (
                          <Badge variant="outline" className="border-green-500 text-green-600">Faol</Badge>
                        ) : (
                          <Badge variant="outline" className="border-red-500 text-red-600">Nofaol</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {hasPermission('users.update') && (
                          <Button size="icon" variant="ghost" onClick={() => setEditing(u)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {showAdd && <UserDialog roles={roles} onClose={() => setShowAdd(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['users'] })} />}
      {editing && <UserDialog user={editing} roles={roles} onClose={() => setEditing(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['users'] })} />}
    </div>
  )
}
