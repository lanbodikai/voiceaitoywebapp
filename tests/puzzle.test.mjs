import test from 'node:test'
import assert from 'node:assert/strict'
import { earnedPuzzlePieceCount, markPuzzleLayoutCompleted, nextPuzzleLayout, puzzleLayout, puzzleLayoutIDs, savedPuzzleLayout, selectPuzzleLayout, storyProgressPercentage } from '../src/puzzle.ts'

test('every layout supplies the exact five- and six-piece puzzle shapes', () => {
  for (const id of puzzleLayoutIDs) {
    for (const count of [5, 6]) {
      const pieces = puzzleLayout(id, count)
      assert.equal(pieces.length, count)
      assert.ok(pieces.every((piece) => piece.clipPath.startsWith('polygon(')))
      assert.ok(pieces.every((piece) => piece.path.includes('C ')), 'each piece has rounded jigsaw tabs or sockets')
      assert.deepEqual(pieces.map((piece) => piece.delayMs), Array.from({length:count}, (_, index) => index * 150))
    }
  }
})

function polygon(clipPath) {
  return clipPath.slice(8,-1).split(',').map(pair=>pair.trim().split(' ').map(parseFloat))
}
function contains(points,x,y) {
  let inside=false
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const [xi,yi]=points[i], [xj,yj]=points[j]
    if((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside
  }
  return inside
}
test('jigsaw pieces tile the complete picture with matching boundaries and no holes or overlaps', () => {
  for(const layout of puzzleLayoutIDs) for(const count of [5,6]) {
    const shapes=puzzleLayout(layout,count).map(piece=>polygon(piece.clipPath))
    assert.ok(shapes.flat().every(point=>point.every(v=>v>=0 && v<=100)), 'outer frame stays within the image')
    let totalArea=0
    for(const shape of shapes) {
      let area=0
      for(let i=0;i<shape.length;i++) { const a=shape[i],b=shape[(i+1)%shape.length];area+=a[0]*b[1]-b[0]*a[1] }
      totalArea+=Math.abs(area/2)
    }
    assert.ok(Math.abs(totalArea-10000)<.02,`${layout}/${count} covers exactly the image area`)
    for(let row=0;row<41;row++) for(let col=0;col<67;col++) {
      const x=(col+.371)/67*100,y=(row+.613)/41*100
      assert.equal(shapes.filter(shape=>contains(shape,x,y)).length,1,`${layout}/${count} at ${x},${y}`)
    }
  }
})
test('story percentages reflect unique current-visit checkpoints, rounded for six-piece stories', () => {
  assert.equal(storyProgressPercentage([],5),0)
  assert.equal(storyProgressPercentage(['one','two','two'],5),40)
  assert.equal(storyProgressPercentage(['one'],6),17)
  assert.equal(storyProgressPercentage(['one','two'],6),33)
  assert.equal(storyProgressPercentage(['1','2','3','4','5','6','7'],6),100)
  assert.equal(storyProgressPercentage([],0),0)
})

test('earned pieces are unique, restored from checkpoint ids, and capped', () => {
  assert.equal(earnedPuzzlePieceCount([], 5), 0)
  assert.equal(earnedPuzzlePieceCount(['one', 'one', 'two'], 5), 2)
  assert.equal(earnedPuzzlePieceCount(['one', 'two', 'three', 'four', 'five', 'six'], 5), 5)
})

test('completed replays rotate layouts while an interrupted visit resumes its layout', () => {
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  const storyID = `puzzle-test-${Date.now()}`
  assert.equal(selectPuzzleLayout(storyID, 'english', 'new'), 'ribbons')
  const before = [...values]
  assert.equal(savedPuzzleLayout(storyID, 'english'), 'ribbons')
  assert.equal(savedPuzzleLayout(storyID, 'chinese'), 'ribbons')
  assert.deepEqual([...values],before,'gallery reads must not initialize or rotate layouts')
  markPuzzleLayoutCompleted(storyID, 'english', 'ribbons')
  assert.equal(selectPuzzleLayout(storyID, 'english', 'replay'), 'patchwork')
  assert.equal(savedPuzzleLayout(storyID, 'english'), 'patchwork')
  assert.equal(selectPuzzleLayout(storyID, 'english', 'resume'), 'patchwork')
  markPuzzleLayoutCompleted(storyID, 'english', 'patchwork')
  assert.equal(selectPuzzleLayout(storyID, 'english', 'replay'), 'panels')
  assert.equal(nextPuzzleLayout('panels'), 'ribbons')
})
