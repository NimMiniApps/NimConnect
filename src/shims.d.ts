declare module '@nimiq/identicons/dist/identicons.bundle.min.js' {
  const Identicons: {
    toDataUrl(text: string): Promise<string>
    placeholderToDataUrl(color?: string, strokeWidth?: number): string
  }
  export default Identicons
}
