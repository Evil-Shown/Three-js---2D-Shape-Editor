import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import Editor from './components/Editor'
import CustomShapesGallery from './pages/CustomShapesGallery'

function EditorByParam() {
  const { shapeId } = useParams()
  const id = shapeId != null && shapeId !== '' ? Number(shapeId) : null
  return <Editor shapeId={Number.isFinite(id) ? id : null} />
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CustomShapesGallery />} />
        <Route path="/editor" element={<Editor shapeId={null} />} />
        <Route path="/editor/:shapeId" element={<EditorByParam />} />
        <Route path="/custom-shapes" element={<CustomShapesGallery />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
