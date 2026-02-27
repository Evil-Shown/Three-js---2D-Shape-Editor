// src/parameters/ParameterTypes.js

export const ParameterType = Object.freeze({
  LINEAR:  'LINEAR',
  RADIUS:  'RADIUS',
  ANGLE:   'ANGLE',
  OFFSET:  'OFFSET',
  DERIVED: 'DERIVED',
  TRIM:    'TRIM',
})

export const PARAM_TYPE_META = Object.freeze({
  [ParameterType.LINEAR]: {
    icon: '↔',
    label: 'Linear',
    color: '#88aaff',
    unit: 'mm',
    description: 'Distance dimension (width, height, length)',
  },
  [ParameterType.RADIUS]: {
    icon: '◠',
    label: 'Radius',
    color: '#ff88cc',
    unit: 'mm',
    description: 'Arc corner radius',
  },
  [ParameterType.ANGLE]: {
    icon: '∠',
    label: 'Angle',
    color: '#ffcc44',
    unit: '°',
    description: 'Rotation angle in degrees',
  },
  [ParameterType.OFFSET]: {
    icon: '⟺',
    label: 'Offset',
    color: '#88ffaa',
    unit: 'mm',
    description: 'Service offset distance (from edge services)',
  },
  [ParameterType.DERIVED]: {
    icon: 'ƒ',
    label: 'Derived',
    color: '#cc88ff',
    unit: 'mm',
    description: 'Computed from other parameters',
  },
  [ParameterType.TRIM]: {
    icon: '✂',
    label: 'Trim',
    color: '#ff8844',
    unit: 'mm',
    description: 'Trim bottom/left service accumulation',
  },
})

export const SERVICE_LABELS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']

export const SERVICE_COLORS = Object.freeze({
  E1: '#4488ff',
  E2: '#44cc66',
  E3: '#cccc44',
  E4: '#ff8844',
  E5: '#cc44ff',
  E6: '#44cccc',
  E7: '#ff4488',
  E8: '#88ff44',
})

export const POINT_STATUS = Object.freeze({
  UNSET:    'unset',
  ASSIGNED: 'assigned',
  VERIFIED: 'verified',
  ERROR:    'error',
})

export const POINT_STATUS_COLORS = Object.freeze({
  [POINT_STATUS.UNSET]:    '#ff4444',
  [POINT_STATUS.ASSIGNED]: '#cccc44',
  [POINT_STATUS.VERIFIED]: '#44cc66',
  [POINT_STATUS.ERROR]:    '#ff2222',
})

const JAVA_RESERVED = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
  'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
  'package', 'private', 'protected', 'public', 'return', 'short', 'static',
  'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
  'transient', 'try', 'void', 'volatile', 'while',
])

export function isValidJavaIdentifier(name) {
  if (!name || typeof name !== 'string') return false
  if (JAVA_RESERVED.has(name)) return false
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
}
