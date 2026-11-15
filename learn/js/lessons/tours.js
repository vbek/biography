// Guided tours: a beginner-first walkthrough for each lesson, keyed by lesson id.
// Each step can hide layers (revealed later), show parts of the stage UI, run setup code, and wait for the visitor
// to try something before "Next" unlocks. See renderTour() in app.js.

export const TOURS = {
    'linear-regression': [
        {
            title: 'What is machine learning?',
            text: `<p>Normally we write the rules for a computer. In <b>machine learning</b>, we show the computer <b>examples</b> and let it find the rule by itself.</p>
                   <p>Each <span class="t0">dot</span> on the left is one example. Think of <b>x</b> (left to right) as hours studied and <b>y</b> (bottom to top) as the exam score.</p>`,
            hide: ['model', 'residuals'],
            do: (a) => { a.view('2d'); a.dataset('linear'); a.set('degree', 1); a.set('mode', 'exact'); a.set('residuals', true); a.set('squares', false); },
        },
        {
            title: 'Spot the pattern',
            text: `<p>Look at the dots as a whole. They drift <b>up and to the right</b>: more hours usually means a higher score. Not perfectly, though, because real data is noisy.</p>
                   <p>Our goal: draw <b>one straight line</b> that follows this trend. Then, for a new student, we can read their likely score off the line. That line is our <b>model</b>.</p>
                   <p>The hollow rings are <b>test</b> examples. We hide them from the model so we can check it later on data it never saw.</p>`,
            hide: ['model', 'residuals'],
        },
        {
            title: 'A first, lazy guess',
            text: `<p>Here is a terrible starting guess: a <span class="t3">flat line</span> at y = 0. It predicts the same score for everyone.</p>
                   <p>The dashed <span class="t1">red lines</span> show how wrong it is for each dot. These gaps are called <b>errors</b> (or residuals).</p>`,
            do: (a) => { a.set('mode', 'gd'); a.reset(); },
        },
        {
            title: 'Measure “how wrong” with one number',
            text: `<p>To compare lines we need a single score. Take each red gap, <b>square it</b> (the boxes), and average them. That is the <b>mean squared error</b>, or <b>MSE</b>.</p>
                   <p>You can read it at the bottom of the canvas. A smaller MSE means a better line. Squaring makes big misses count a lot more than small ones.</p>`,
            ui: ['metrics'],
            do: (a) => { a.set('squares', true); },
        },
        {
            title: 'Let the computer improve it',
            text: `<p>Now the learning part. Press <b>Play</b> (bottom right). On every step the computer nudges the line a little in the direction that lowers the MSE. This is called <b>gradient descent</b>.</p>
                   <p>Watch the red gaps shrink and the MSE fall, step after step.</p>`,
            ui: ['metrics', 'playbar'],
            do: (a) => { a.set('squares', false); a.reset(); },
            wait: { label: 'Press Play and let it run for a few seconds', done: 'See how the line settled into the trend.', check: (s) => s.epoch >= 40 },
        },
        {
            title: 'Your turn: grab a dot',
            text: `<p>The best possible line can also be calculated in one shot, and that is what's on screen now.</p>
                   <p><b>Drag any dot</b> up or down. The line instantly re-fits. Try dragging one dot far away and notice how much one bad example can pull the whole line.</p>`,
            ui: ['metrics'],
            do: (a) => { a.set('mode', 'exact'); },
            wait: { label: 'Drag any dot on the canvas', check: (s, P, ev) => ev.drags >= 1 },
        },
        {
            title: 'You’ve got the core idea',
            text: `<p><b>Examples → a model with adjustable knobs → a score for how wrong it is → adjust the knobs to lower the score.</b> Every lesson after this is a variation on that loop.</p>
                   <p>Now explore freely: click empty space to add dots, press the dice for new random data, open the <b>3D plane</b> view, or try the <b>challenges</b> at the top. The <b>Python</b> tab runs the same model with real code.</p>`,
            ui: ['metrics', 'playbar'],
        },
    ],

    knn: [
        {
            title: 'A new kind of question',
            text: `<p>Last lesson predicted a <b>number</b>. Now each dot has a <b>category</b>, shown by its color: <span class="t0">cyan</span> or <span class="t1">coral</span>. Think "spam" vs "not spam", or "cat" vs "dog".</p>
                   <p>The question: if a <b>new point</b> lands somewhere on this map, which color should it be?</p>`,
            hide: ['regions', 'radar'],
            do: (a) => { a.dataset('moons'); a.set('k', 5); a.set('metric', 'euclidean'); a.set('weights', 'uniform'); a.set('regions', true); },
        },
        {
            title: 'Ask the neighbours',
            text: `<p>K-Nearest Neighbors uses a very human rule: <b>look at the K closest dots and go with the majority</b>.</p>
                   <p>Move your mouse over the canvas. The glowing lines connect to the <b>5 nearest dots</b>, and the little pie at your cursor shows their vote.</p>`,
            hide: ['regions'],
            wait: { label: 'Move your cursor around the canvas', done: 'That vote is the whole algorithm!', check: (s, P, ev) => ev.hovers >= 25 },
        },
        {
            title: 'Color the whole map',
            text: `<p>Now imagine doing that vote at <b>every spot</b> on the map and coloring the spot by the winner. That is what you see now: the model's <b>decision regions</b>.</p>
                   <p>Strong color means the neighbours agreed; pale color means the vote was close.</p>`,
        },
        {
            title: 'K = 1: trust a single neighbour',
            text: `<p>With <b>K = 1</b>, every spot copies its single closest dot. The map breaks into jagged islands around every stray dot.</p>
                   <p>Every training dot is now "right" (it is its own neighbour!), but the map is following noise. That is called <b>overfitting</b>. Check the <b>Test acc</b> at the bottom.</p>`,
            ui: ['metrics'],
            controls: ['k'],
            do: (a) => { a.set('k', 1); },
        },
        {
            title: 'Bigger K, smoother map',
            text: `<p>With <b>K = 15</b>, a single odd dot gets outvoted by its neighbours, so the boundary becomes smooth.</p>
                   <p>Too large a K washes out real detail, though. Slide K yourself and watch the regions <b>morph</b>.</p>`,
            ui: ['metrics'],
            controls: ['k'],
            do: (a) => { a.set('k', 15); },
        },
        {
            title: 'Your turn: plant a dot',
            text: `<p>Pick a color in the <b>Add</b> picker (top left) and <b>click</b> somewhere on the map to add a dot. The regions bend around it right away, because KNN simply remembers every example.</p>`,
            ui: ['classpick', 'metrics'],
            wait: { label: 'Click on the canvas to add a dot', check: (s, P, ev) => ev.clicks >= 1 },
        },
        {
            title: 'Over to you',
            text: `<p>Try the other datasets, press the dice for fresh random data, raise the <b>Spread</b> slider (Controls tab) to make the classes overlap, and take on the challenges at the top.</p>`,
            ui: ['classpick', 'metrics'],
        },
    ],

    'decision-tree': [
        {
            title: 'Twenty questions',
            text: `<p>A decision tree classifies by asking a chain of <b>yes/no questions</b>, like a game of twenty questions:</p>
                   <p><i>"Is x less than 0.3?" → yes → "Is y above −0.2?" → no → it's <span class="t1">coral</span>.</i></p>
                   <p>Right now the tree hasn't asked anything yet, so the map is blank.</p>`,
            do: (a) => { a.dataset('moons'); a.set('depth', 3); a.set('minLeaf', 1); a.set('criterion', 'gini'); a.reset(); },
        },
        {
            title: 'The first question',
            text: `<p>The tree tries every possible straight cut and keeps the one that best separates the colors. That one question splits the map into <b>two boxes</b>.</p>
                   <p>Each box simply predicts the color most common inside it.</p>`,
            ui: ['metrics'],
            do: (a) => { a.reset(); a.step(1); },
        },
        {
            title: 'Keep asking',
            text: `<p>Each box can ask its own next question and split again. Press <b>Step</b> (bottom right) to grow the tree one level at a time, and watch the accuracy climb.</p>`,
            ui: ['metrics', 'playbar'],
            wait: { label: 'Press Step until the tree is 3 levels deep', check: (s) => s.shown >= 3 },
        },
        {
            title: 'Read a rule',
            text: `<p>Every box is the answer to a specific chain of questions. <b>Hover</b> over any region to read the rule that leads there and how pure the box is.</p>`,
            ui: ['metrics'],
            wait: { label: 'Hover over a few regions', check: (s, P, ev) => ev.hovers >= 15 },
        },
        {
            title: 'Too many questions',
            text: `<p>Let the tree ask up to <b>12</b> questions deep. It keeps slicing until every box is perfectly pure, carving tiny boxes around single stray dots.</p>
                   <p>Training accuracy hits 100%, but the hollow <b>test</b> dots are scored worse. The tree memorised noise: <b>overfitting</b>. Slide the depth back down to find a balance.</p>`,
            ui: ['metrics'],
            controls: ['depth'],
            do: (a) => { a.set('depth', 12); },
        },
        {
            title: 'Over to you',
            text: `<p>Try <b>Reset</b> then <b>Play</b> to watch a tree grow, switch datasets, add points of your own, and try the challenges at the top.</p>`,
            ui: ['metrics', 'playbar', 'classpick'],
        },
    ],

    'gradient-descent': [
        {
            title: 'Learning = walking downhill',
            text: `<p>Every model has knobs (its <b>weights</b>). For each setting of two knobs we can measure how wrong the model is: its <b>loss</b>.</p>
                   <p>Plot the loss for every setting and you get this landscape. <b>Height = how wrong.</b> Low and blue is good; high and red is bad. Drag to spin it around.</p>`,
            do: (a) => { a.view('3d'); a.dataset('bowl'); a.set('lr', 0.1); a.set('momentum', 0); a.reset(); },
        },
        {
            title: 'The ball is the model',
            text: `<p>The glowing <span class="t2">ball</span> marks the current knob settings. Training a model means moving this ball to the <b>lowest point</b>, marked with a green ring.</p>
                   <p>But the computer cannot see the whole landscape. It only feels the <b>slope under the ball</b>.</p>`,
        },
        {
            title: 'Feel the slope, take a step',
            text: `<p><b>Gradient descent</b>: measure which way is downhill and take a small step that way. Then repeat.</p>
                   <p>Press <b>Step</b> a few times and watch the ball and the <b>Loss</b> number.</p>`,
            ui: ['playbar', 'metrics'],
            wait: { label: 'Press Step 3 times', check: (s) => s.steps >= 3 },
        },
        {
            title: 'Step size matters',
            text: `<p>The size of each step is the <b>learning rate</b>. It is set high now. Press <b>Play</b>.</p>
                   <p>Each step jumps right past the bottom and lands higher on the other side, until the ball flies off. Too big a learning rate makes training <b>blow up</b>.</p>`,
            ui: ['playbar', 'metrics'],
            controls: ['lr'],
            do: (a) => { a.dataset('bowl'); a.set('momentum', 0); a.set('lr', 0.85); a.reset(); },
            wait: { label: 'Press Play and watch it overshoot', check: (s) => s.diverged || s.steps >= 8 },
        },
        {
            title: 'Bumpy landscapes',
            text: `<p>Real landscapes are rarely a smooth bowl. This one has a <b>small dip</b> near the ball and a <b>deeper valley</b> further away.</p>
                   <p>Press <b>Play</b>. Plain gradient descent rolls into the nearest dip and stops: it is <b>stuck</b> in a local minimum.</p>`,
            ui: ['playbar', 'metrics'],
            do: (a) => { a.dataset('local'); a.set('lr', 0.1); a.set('momentum', 0); a.reset(); },
            wait: { label: 'Press Play and watch where it stops', check: (s) => s.steps >= 20 },
        },
        {
            title: 'Momentum: a heavier ball',
            text: `<p><b>Momentum</b> lets the ball keep some speed from previous steps, like a heavy ball rolling downhill. It can roll straight through the small dip.</p>
                   <p>Momentum is now 0.9. Press <b>Play</b> again.</p>`,
            ui: ['playbar', 'metrics'],
            controls: ['momentum'],
            do: (a) => { a.set('momentum', 0.9); a.reset(); },
            wait: { label: 'Press Play and see where it ends up', check: (s) => s.reachedGlobal || s.steps >= 200 },
        },
        {
            title: 'Over to you',
            text: `<p><b>Click anywhere on the surface</b> to drop the ball there. Try the Saddle and Ravine landscapes, switch to the flat <b>Contour map</b>, and take on the challenges at the top.</p>`,
            ui: ['playbar', 'metrics'],
        },
    ],

    'k-means': [
        {
            title: 'No labels this time',
            text: `<p>So far every dot came with an answer (a number or a color). Here nobody tells us anything. The dots are <b>unlabelled</b>.</p>
                   <p>Your eyes can probably spot some groups. Can the computer find them on its own? That is called <b>clustering</b>.</p>`,
            hide: ['regions', 'centroids'],
            do: (a) => { a.view('2d'); a.dataset('blobs'); a.set('k', 4); a.set('init', 'random'); a.reset(); },
        },
        {
            title: 'Drop some centres',
            text: `<p>We tell K-means how many groups to look for: <b>K = 4</b>. It starts by dropping 4 <b>centres</b> (the ✕ marks) on random dots.</p>
                   <p>They're probably in bad places. That's fine. Watch them fix themselves.</p>`,
            hide: ['regions'],
            do: (a) => { a.reset(); },
        },
        {
            title: 'Move 1: assign',
            text: `<p>Every dot joins the group of its <b>nearest centre</b> and takes its color.</p>
                   <p>Press <b>Step</b> (bottom right) to do this.</p>`,
            hide: ['regions'],
            ui: ['playbar'],
            wait: { label: 'Press Step once', check: (s) => s.phase === 'update' || s.iter >= 1 },
        },
        {
            title: 'Move 2: update',
            text: `<p>Now each centre moves to the <b>middle (average)</b> of the dots that joined it.</p>
                   <p>Press <b>Step</b> again and watch the centres glide.</p>`,
            hide: ['regions'],
            ui: ['playbar'],
            wait: { label: 'Press Step again', check: (s) => s.iter >= 1 },
        },
        {
            title: 'Repeat until nothing changes',
            text: `<p>Assign, update, assign, update… The shading now shows each centre's <b>territory</b>, meaning the area closest to it.</p>
                   <p>Press <b>Play</b>. It stops by itself when no dot switches groups. That is called <b>converged</b>.</p>`,
            ui: ['playbar', 'metrics'],
            wait: { label: 'Press Play until it converges', check: (s) => s.converged },
        },
        {
            title: 'Over to you',
            text: `<p>Did it find the 4 blobs, or did two centres end up sharing one? Random starts can go wrong. Press <b>Reset</b> to try again, <b>drag a centre</b> somewhere silly, try other datasets, or open the <b>3D</b> view.</p>`,
            ui: ['playbar', 'metrics'],
        },
    ],

    'svm-kernel': [
        {
            title: 'A ring around a core',
            text: `<p>Two classes again. <span class="t0">Cyan</span> dots sit in the middle and <span class="t1">coral</span> dots form a <b>ring</b> around them.</p>
                   <p>Question: can you draw <b>one straight line</b> that puts all cyan on one side and all coral on the other?</p>`,
            hide: ['boundary'],
            do: (a) => { a.dataset('circles'); a.set('C', 1); a.set('lift', 0); a.view('2d'); },
        },
        {
            title: 'A straight line fails',
            text: `<p>No. This is the best straight line a linear model can find, and it gets roughly <b>half</b> the dots wrong (see <b>Accuracy</b>).</p>
                   <p>Some problems just aren't straight-line problems… <b>in two dimensions</b>.</p>`,
            ui: ['metrics'],
        },
        {
            title: 'The trick: add a height',
            text: `<p>Give every dot a <b>height</b> equal to its squared distance from the centre: <b>z = x² + y²</b>.</p>
                   <p>Watch: the cyan core stays <b>low</b> and the coral ring <b>rises</b>. Same dots, one extra number each.</p>`,
            ui: ['metrics'],
            do: (a) => { a.action('lift'); },
        },
        {
            title: 'Now a flat sheet works',
            text: `<p>In 3D, a perfectly <b>flat sheet</b> (gold) slides between the low dots and the high dots. Accuracy: <b>100%</b>.</p>
                   <p><b>Drag</b> the 3D view to look at it from the side.</p>`,
            ui: ['metrics'],
            wait: { label: 'Drag to spin the 3D view', check: (s, P, ev) => s.view === '3d' && ev.drags >= 1 },
        },
        {
            title: 'Back to 2D: a circle!',
            text: `<p>Flatten everything back down. The flat cut from 3D shows up in 2D as a <b>circle</b>, a curved boundary made by a straight-line model.</p>
                   <p>That's the <b>kernel trick</b>: lift the data into more dimensions where a simple model works.</p>`,
            ui: ['metrics'],
            do: (a) => { a.action('drop'); },
        },
        {
            title: 'Over to you',
            text: `<p>Use the <b>Lift</b> slider to stop halfway, change <b>C</b> to widen or narrow the margin, and try Moons, where this particular lift isn't enough.</p>`,
            ui: ['metrics'],
        },
    ],

    pca: [
        {
            title: 'Three numbers per dot',
            text: `<p>Each dot here has <b>3 numbers</b> (x, y, z), so it lives in 3D. Real data often has dozens or thousands of numbers per example.</p>
                   <p><b>Drag</b> to spin the cloud. From some angles it looks round; from others it's <b>flat like a pancake</b>.</p>`,
            hide: ['arrows', 'plane'],
            do: (a) => { a.dataset('pancake'); a.set('k', 2); a.set('collapse', 0); a.set('thick', 0.25); },
            wait: { label: 'Drag to spin the cloud', check: (s, P, ev) => ev.drags >= 1 },
        },
        {
            title: 'Find the directions that matter',
            text: `<p>PCA finds the direction in which the cloud is <b>most stretched</b>: <span class="t1">PC1</span>. Then the next most stretched, at a right angle to the first: <span class="t0">PC2</span>. Then what's left: <span class="t2">PC3</span>.</p>
                   <p>Longer arrow = more spread in that direction. The labels show each one's share.</p>`,
            hide: ['plane'],
        },
        {
            title: 'Keep the big two',
            text: `<p>PC3 is tiny: the pancake is thin. If we keep only <b>PC1 and PC2</b>, the data sits on this <b>flat plane</b>.</p>`,
        },
        {
            title: 'Squash it',
            text: `<p>Press <b>Play</b> to slide every dot straight onto the plane. We're throwing away the third number.</p>`,
            ui: ['playbar'],
            do: (a) => { a.set('collapse', 0); },
            wait: { label: 'Press Play to collapse the cloud', check: (s, P) => P.collapse >= 0.99 },
        },
        {
            title: 'How much did we lose?',
            text: `<p><b>Variance retained</b> (top left) shows how much of the original spread survived: about <b>98%</b>.</p>
                   <p>We went from <b>3 numbers to 2</b> and kept almost everything. That's <b>dimensionality reduction</b>: simpler data, same story. The small square shows the result as a flat 2D picture.</p>`,
            ui: ['metrics'],
        },
        {
            title: 'Over to you',
            text: `<p>Try keeping just <b>1</b> component, switch to the <b>Ball</b> (no good flat direction) or the curly <b>Swirl</b>, and change the cloud's thickness.</p>`,
            ui: ['metrics', 'playbar'],
            controls: ['k'],
        },
    ],

    'neural-network': [
        {
            title: 'A network of tiny decision makers',
            text: `<p>On the right is a <b>neural network</b>. Inputs on the left (a dot's <b>x</b> and <b>y</b>), the answer on the right (cyan or coral), and <b>hidden neurons</b> in between.</p>
                   <p>Each line is a <b>weight</b>: how strongly one neuron listens to another. Training means adjusting all those weights.</p>`,
            hide: ['heatmap'],
            do: (a) => { a.view('split'); a.dataset('circles'); a.set('layers', 1); a.set('width', 4); a.set('activation', 'tanh'); a.set('lr', 0.03); a.reset(); },
        },
        {
            title: 'One neuron = one straight cut',
            text: `<p>Start with just <b>one hidden neuron</b>. The left side now shows what the network predicts everywhere.</p>
                   <p>Press <b>Play</b> to train. A single neuron can only split the map with <b>one straight edge</b>, so it can't wrap around the ring.</p>`,
            ui: ['playbar', 'metrics'],
            do: (a) => { a.set('width', 1); a.reset(); },
            wait: { label: 'Press Play and let it train a moment', check: (s) => s.epoch >= 150 },
        },
        {
            title: 'More neurons, more edges',
            text: `<p>Now <b>4 neurons</b>. Each one draws its own soft edge, and the network combines them into a <b>closed curve</b>.</p>
                   <p>Press <b>Play</b> and watch the loss line fall (bottom left) as the curve wraps the cyan core.</p>`,
            ui: ['playbar', 'metrics'],
            do: (a) => { a.set('width', 4); a.reset(); },
            wait: { label: 'Press Play and watch it learn', check: (s) => s.epoch >= 250 },
        },
        {
            title: 'Look inside',
            text: `<p>Move your cursor over the <b>map on the left</b>. That spot is sent through the network, and the neurons on the right <b>glow</b> by how strongly they fire.</p>
                   <p>Thick lines are big weights; <span class="t0">cyan</span> is positive, <span class="t1">coral</span> negative.</p>`,
            ui: ['metrics'],
            wait: { label: 'Hover over the map on the left', check: (s, P, ev) => ev.hovers >= 20 },
        },
        {
            title: 'What does one neuron see?',
            text: `<p>Now hover over a <b>hidden neuron</b> (the middle column on the right). The map switches to show where <b>that single neuron</b> fires. Each one has learned its own straight edge.</p>`,
            ui: ['metrics'],
        },
        {
            title: 'Over to you',
            text: `<p>Add layers and neurons, try ReLU, crank the learning rate up to see training go wild, and try Moons or Blobs.</p>`,
            ui: ['metrics', 'playbar', 'classpick'],
        },
    ],
};
