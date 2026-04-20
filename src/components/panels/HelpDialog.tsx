import { useServices, useStudio, useUi } from '../../app/context';
import { Dialog, Kbd } from '../ui/primitives';

export function HelpDialog() {
  const { ui } = useServices();
  const open = useUi((s) => s.helpOpen);
  const keyMap = useStudio((s) => s.settings.keyMap);

  return (
    <Dialog open={open} onClose={() => ui.setState({ helpOpen: false })} eyebrow="Field guide" title="How CUBELAB works" className="help">
      <div className="help-grid">
        <section>
          <h3 className="eyebrow">Gestures</h3>
          <ul className="help-list">
            <li>
              <strong>Twist</strong> — press a sticker and push it along its row or column. The layer under your finger follows; release past
              ~25° (or flick) to commit, otherwise it springs back. The move you are making is shown beside the pointer.
            </li>
            <li>
              <strong>Slices</strong> — the middle row or column turns the middle layer. On the front face, push the middle column up or down for{' '}
              <strong>M</strong>, the middle row sideways for <strong>E</strong>; push the middle strip of the top or a side face for{' '}
              <strong>S</strong>. The centre sticker belongs to both strips, so its drag direction decides.
            </li>
            <li>
              <strong>Orbit</strong> — drag the empty background to turn the cube over in any direction, like rolling it in your hand: keep
              dragging up or down and white ends up facing the floor. Right-drag or Shift-drag orbits from anywhere, including over the cube.{' '}
              <Kbd>C</Kbd> brings the view home.
            </li>
            <li>
              <strong>Zoom</strong> — scroll, or pinch with two fingers (two fingers also orbit). On phones, the Twist / Orbit switch makes
              single-finger drags unambiguous.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="eyebrow">Notation</h3>
          <p>
            <strong>U D L R F B</strong> turn the Up, Down, Left, Right, Front and Back faces clockwise <em>as seen looking at that face</em>.
            <strong> '</strong> is counter-clockwise, <strong>2</strong> a half turn.
          </p>
          <p>
            <strong>M</strong> is the middle layer between L and R, turning like L. <strong>E</strong> sits between U and D and turns like D.{' '}
            <strong>S</strong> sits between F and B and turns like F.
          </p>
          <p>
            <strong>x y z</strong> rotate the whole cube like R, U and F — a re-grip, not a turn. Letters always mean positions: after{' '}
            <strong>x2</strong> yellow is on top and <strong>U</strong> turns it. Orbiting only changes your view, never a letter.
          </p>
          <p className="muted">
            Turns count in STM (any layer, any angle = 1). History also records HTM (a slice = 2) and QTM (a double = 2 quarters). Rotations
            count 0, never start the clock, and are allowed during inspection.
          </p>
        </section>

        <section>
          <h3 className="eyebrow">Timer</h3>
          <ul className="help-list">
            <li>
              <strong>Casual</strong> (default): after New Scramble the clock starts on your first turn and stops on the turn that solves the cube.
            </li>
            <li>
              <strong>Spacebar</strong>: optional 15 s inspection, then hold Space (or press and hold the clock) for 0.3 s until it turns green and
              release to start. Under 15 s of inspection is clean, 15 s or more adds +2, 17 s or more is DNF — a training mirror of current WCA
              practice, not an official timer.
            </li>
            <li>Undo/redo during an attempt saves it as practice. Auto Solve ends the attempt unrecorded. Only clean solves count toward PB, ao5, ao12.</li>
          </ul>
        </section>

        <section>
          <h3 className="eyebrow">Keyboard</h3>
          <table className="key-table">
            <tbody>
              {keyMap === 'faces' ? (
                <>
                  <tr>
                    <td>
                      <Kbd>U</Kbd> <Kbd>D</Kbd> <Kbd>L</Kbd> <Kbd>R</Kbd> <Kbd>F</Kbd> <Kbd>B</Kbd>
                    </td>
                    <td>
                      Faces clockwise · with <Kbd>Shift</Kbd> counter-clockwise
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Kbd>M</Kbd> <Kbd>E</Kbd> <Kbd>S</Kbd>
                    </td>
                    <td>
                      Slices · with <Kbd>Shift</Kbd> counter-clockwise
                    </td>
                  </tr>
                </>
              ) : (
                <>
                  <tr>
                    <td>
                      <Kbd>I</Kbd>/<Kbd>K</Kbd> R · <Kbd>J</Kbd>/<Kbd>F</Kbd> U · <Kbd>H</Kbd>/<Kbd>G</Kbd> F · <Kbd>D</Kbd>/<Kbd>E</Kbd> L ·{' '}
                      <Kbd>S</Kbd>/<Kbd>L</Kbd> D · <Kbd>W</Kbd>/<Kbd>O</Kbd> B
                    </td>
                    <td>Speed layout (clockwise / counter-clockwise)</td>
                  </tr>
                  <tr>
                    <td>
                      <Kbd>5</Kbd>/<Kbd>6</Kbd> M · <Kbd>2</Kbd>/<Kbd>3</Kbd> E · <Kbd>8</Kbd>/<Kbd>9</Kbd> S
                    </td>
                    <td>Slices (clockwise / counter-clockwise)</td>
                  </tr>
                </>
              )}
              <tr>
                <td>
                  <Kbd>X</Kbd> <Kbd>Y</Kbd> <Kbd>Z</Kbd>
                </td>
                <td>
                  Rotate the whole cube · with <Kbd>Shift</Kbd> counter-clockwise
                </td>
              </tr>
              <tr>
                <td>
                  <Kbd>N</Kbd> · <Kbd>A</Kbd>
                </td>
                <td>New Scramble · Auto Solve</td>
              </tr>
              <tr>
                <td>
                  <Kbd>P</Kbd> · <Kbd>,</Kbd> <Kbd>.</Kbd>
                </td>
                <td>Play / pause solution · step back / forward</td>
              </tr>
              <tr>
                <td>
                  <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> · <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd>
                </td>
                <td>Undo · redo</td>
              </tr>
              <tr>
                <td>
                  <Kbd>Space</Kbd>
                </td>
                <td>Spacebar timer: inspect / hold to arm / stop (DNF)</td>
              </tr>
              <tr>
                <td>
                  <Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd> · <Kbd>C</Kbd>
                </td>
                <td>Turn the view (any direction) · reset the view</td>
              </tr>
              <tr>
                <td>
                  <Kbd>`</Kbd> · <Kbd>?</Kbd> · <Kbd>Esc</Kbd>
                </td>
                <td>Zen mode · this guide · close / cancel</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
      <p className="help-footnote muted">
        Scrambles are random-state (uniformly random legal positions). Auto Solve reads whatever state the cube is in — slices and rotations
        included. It weighs homing displaced centres with slice turns against solving in the orientation you are holding, plays the shorter, and
        verifies every solution before it plays.
        Everything runs locally; nothing is sent anywhere.
      </p>
    </Dialog>
  );
}
