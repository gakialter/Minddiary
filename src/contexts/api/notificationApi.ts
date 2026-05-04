import { IS_ELECTRON } from '../../utils/apiAdapter'
import type { NotificationContextAPI } from '../../types/api'

export const createNotificationApi = (): NotificationContextAPI => ({
    show: async (title: string, body: string) => {
        if (IS_ELECTRON) return window.api.notification.show(title, body)
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body, icon: '/favicon.ico' })
        }
    }
})
