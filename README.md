GSAP Editor
A modern 2D shape editor built with React, Three.js, and Vite. This project provides an interactive environment for creating, editing, and exporting 2D geometric shapes, with advanced features such as snapping, constraints, annotation, and real-time preview.

Features
Shape Tools: Draw and edit lines, rectangles, circles, arcs, and more.
Move & Select: Intuitive selection and manipulation of shapes.
Snapping: Smart snapping to grid, points, and geometry for precision.
Constraints: Apply geometric constraints to maintain relationships between shapes.
Annotations: Add dimensions and notes to your drawings.
Export: Export your work in various formats.
Preview: Real-time rendering and preview using Three.js.
Undo/Redo: Command history for non-destructive editing.
Project Structure
src/components/ — Main UI components (e.g., Editor)
src/tools/ — Shape and editing tools (LineTool, ArcTool, etc.)
src/core/ — Core logic (CommandHistory, CoordinateEngine, EventBus)
src/constraints/ — Constraint engine for geometric relationships
src/snap/ — Snapping logic
src/render/ — Rendering layers (Grid, Annotations)
src/three/ — Three.js integration for preview
src/export/ — Export services
src/store/ — State management
Getting Started
Prerequisites
Node.js (v16 or higher recommended)
npm
Installation
Clone the repository:
git clone <repo-url>
cd gsap-editor
Install dependencies:
npm install
Start the development server:
npm run dev
Open your browser and navigate to the local server URL (usually http://localhost:5173).
Scripts
npm run dev — Start the development server
npm run build — Build for production
npm run preview — Preview the production build
Technologies Used
React
Three.js
Vite
GSAP (if used for animation)
Contributing
Contributions are welcome! Please open issues or submit pull requests for improvements and bug fixes.

License
This project is licensed under the MIT License.
