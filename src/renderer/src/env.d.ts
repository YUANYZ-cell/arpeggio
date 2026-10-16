/// <reference types="vite/client" />
import type { ArpeggioApi } from '../../shared/ipc'

declare global {
  interface Window {
    arpeggio: ArpeggioApi
  }
}

export {}
