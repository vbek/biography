// Subjects → levels → lessons. Add a track by appending to SUBJECTS; lessons load on demand.

const ML_LEVELS = [
    { id: 1, name: 'Basics', blurb: 'Fit a line, ask the neighbours, split the space. The three ideas almost every model builds on.' },
    { id: 2, name: 'Core Models', blurb: 'How models actually learn (by rolling downhill) and how they find structure with no labels at all.' },
    { id: 3, name: 'Deep & 3D', blurb: 'Lift data into higher dimensions, squash it back down, and stack neurons into a network.' },
];

// Tiny SVG thumbnails for the overview cards (stroke uses currentColor-free explicit palette vars).
const T = {
    reg: '<svg viewBox="0 0 200 92"><g stroke="var(--c0)" fill="var(--c0)"><circle cx="30" cy="70" r="4"/><circle cx="55" cy="58" r="4"/><circle cx="80" cy="62" r="4"/><circle cx="105" cy="44" r="4"/><circle cx="130" cy="40" r="4"/><circle cx="155" cy="26" r="4"/><circle cx="175" cy="22" r="4"/></g><path d="M20 76L185 16" stroke="var(--c3)" stroke-width="3"/><g stroke="var(--c1)" stroke-dasharray="3 3"><path d="M55 58v6M80 62v-13M130 40v2"/></g></svg>',
    knn: '<svg viewBox="0 0 200 92"><g fill="var(--c0)"><circle cx="40" cy="30" r="4"/><circle cx="62" cy="48" r="4"/><circle cx="48" cy="66" r="4"/></g><g fill="var(--c1)"><circle cx="140" cy="32" r="4"/><circle cx="160" cy="60" r="4"/><circle cx="125" cy="66" r="4"/></g><circle cx="96" cy="50" r="5" fill="none" stroke="var(--text)"/><g stroke="var(--c2)" stroke-width="1.6"><path d="M96 50L62 48M96 50L125 66M96 50L48 66"/></g><circle cx="96" cy="50" r="50" fill="none" stroke="var(--c2)" stroke-dasharray="4 4" opacity=".5"/></svg>',
    tree: '<svg viewBox="0 0 200 92"><rect x="10" y="8" width="80" height="76" fill="var(--c0)" opacity=".18"/><rect x="90" y="8" width="100" height="40" fill="var(--c1)" opacity=".18"/><rect x="90" y="48" width="100" height="36" fill="var(--c0)" opacity=".18"/><path d="M90 8v76M90 48h100" stroke="var(--text)" stroke-width="2"/></svg>',
    gd: '<svg viewBox="0 0 200 92"><path d="M10 14C60 14 70 82 100 82S140 14 190 14" stroke="var(--c6)" stroke-width="3"/><path d="M30 18Q60 30 70 60T100 80" stroke="var(--c2)" stroke-dasharray="2 4" stroke-width="2.5"/><circle cx="100" cy="78" r="6" fill="var(--c2)"/></svg>',
    km: '<svg viewBox="0 0 200 92"><g fill="var(--c0)"><circle cx="40" cy="30" r="3"/><circle cx="50" cy="40" r="3"/><circle cx="35" cy="45" r="3"/></g><g fill="var(--c1)"><circle cx="150" cy="25" r="3"/><circle cx="160" cy="38" r="3"/><circle cx="140" cy="36" r="3"/></g><g fill="var(--c2)"><circle cx="100" cy="70" r="3"/><circle cx="110" cy="62" r="3"/><circle cx="92" cy="60" r="3"/></g><g stroke="var(--text)" stroke-width="2.4"><path d="M38 34l8 8M46 34l-8 8M146 28l8 8M154 28l-8 8M97 61l8 8M105 61l-8 8"/></g></svg>',
    svm: '<svg viewBox="0 0 200 92"><ellipse cx="100" cy="70" rx="70" ry="14" fill="none" stroke="var(--c0)" opacity=".6"/><path d="M40 20Q100 110 160 20" stroke="var(--c3)" stroke-width="2"/><path d="M25 50h150" stroke="var(--c2)" stroke-width="3"/><g fill="var(--c1)"><circle cx="90" cy="70" r="3.5"/><circle cx="108" cy="72" r="3.5"/></g><g fill="var(--c0)"><circle cx="50" cy="30" r="3.5"/><circle cx="150" cy="32" r="3.5"/></g></svg>',
    pca: '<svg viewBox="0 0 200 92"><ellipse cx="100" cy="46" rx="74" ry="22" transform="rotate(-14 100 46)" fill="var(--c0)" opacity=".15"/><path d="M100 46l70-18" stroke="var(--c1)" stroke-width="3.5"/><path d="M100 46l-6-22" stroke="var(--c0)" stroke-width="3"/><path d="M100 46l8 10" stroke="var(--c2)" stroke-width="2.5"/></svg>',
    mlp: '<svg viewBox="0 0 200 92"><g stroke="var(--c0)" opacity=".7"><path d="M30 30L100 16M30 30L100 46M30 62L100 46M30 62L100 76M100 16L170 46M100 46L170 46M100 76L170 46"/></g><g stroke="var(--c1)" opacity=".7"><path d="M30 30L100 76M30 62L100 16"/></g><g fill="var(--c3)"><circle cx="30" cy="30" r="6"/><circle cx="30" cy="62" r="6"/><circle cx="100" cy="16" r="6"/><circle cx="100" cy="46" r="6"/><circle cx="100" cy="76" r="6"/><circle cx="170" cy="46" r="7"/></g></svg>',
};

export const SUBJECTS = [
    {
        id: 'ml',
        name: 'Machine Learning',
        short: 'ML',
        status: 'live',
        headline: 'Machine Learning, <em>by touch</em>',
        lead: 'Eight hands-on lessons that start with a straight line and end with a neural network. Every picture is live: drag the data, nudge a slider, and watch the model think. When you are ready, open the Python tab and run the same idea with real scikit-learn, right in your browser.',
        levels: ML_LEVELS,
        lessons: [
            { id: 'linear-regression', level: 1, title: 'Linear Regression', tag: '2D · 3D', thumb: T.reg, blurb: 'Drag points and watch the best-fit line (or plane) tilt while the dashed error lines shrink.', load: () => import('./lessons/linear-regression.js') },
            { id: 'knn', level: 1, title: 'K-Nearest Neighbors', tag: '2D', thumb: T.knn, blurb: 'Hover anywhere to see which K neighbours vote, and watch the decision regions morph as K changes.', load: () => import('./lessons/knn.js') },
            { id: 'decision-tree', level: 1, title: 'Decision Trees', tag: '2D', thumb: T.tree, blurb: 'Watch the plane slice itself into boxes, one question at a time. Then make it overfit.', load: () => import('./lessons/decision-tree.js') },
            { id: 'gradient-descent', level: 2, title: 'Gradient Descent', tag: '3D', thumb: T.gd, blurb: 'Roll a glowing ball down bowls, saddles and bumpy landscapes. Tune the learning rate and momentum.', load: () => import('./lessons/gradient-descent.js') },
            { id: 'k-means', level: 2, title: 'K-Means Clustering', tag: '2D · 3D', thumb: T.km, blurb: 'Step through assign → update and watch centroids hunt down the clusters in 2D and 3D.', load: () => import('./lessons/k-means.js') },
            { id: 'svm-kernel', level: 3, title: 'SVM & the Kernel Trick', tag: '2D → 3D', thumb: T.svm, blurb: 'Lift circular data into 3D and slice it cleanly with a flat plane.', load: () => import('./lessons/svm-kernel.js') },
            { id: 'pca', level: 3, title: 'PCA', tag: '3D → 2D', thumb: T.pca, blurb: 'Find the directions that matter, then physically collapse a 3D cloud onto a plane.', load: () => import('./lessons/pca.js') },
            { id: 'neural-network', level: 3, title: 'Neural Networks', tag: '2D + 3D', thumb: T.mlp, blurb: 'Train a small network live and watch its weights glow in a 3D node-link diagram.', load: () => import('./lessons/neural-network.js') },
        ],
    },
    {
        id: 'stats',
        name: 'Statistics',
        short: 'Stats',
        status: 'soon',
        headline: 'Statistics, <em>coming soon</em>',
        lead: 'Sampling, distributions, confidence intervals and hypothesis tests, all as hands-on simulations. This track is being built.',
        levels: [], lessons: [],
    },
    {
        id: 'math',
        name: 'Mathematics',
        short: 'Math',
        status: 'soon',
        headline: 'Mathematics, <em>coming soon</em>',
        lead: 'Linear algebra and calculus you can grab and move: vectors, matrices as transformations, derivatives and integrals. This track is being built.',
        levels: [], lessons: [],
    },
];

export function findLesson(subjectId, lessonId) {
    const s = SUBJECTS.find((x) => x.id === subjectId);
    if (!s) return null;
    const i = s.lessons.findIndex((l) => l.id === lessonId);
    return i < 0 ? null : { subject: s, lesson: s.lessons[i], index: i };
}
