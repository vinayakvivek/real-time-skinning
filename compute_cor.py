import json
from pprint import pprint
import numpy as np
import multiprocessing as mp

eps = 1e-8

def get_max_bone_index(skinIndices):

    max_index = 0

    for i in skinIndices:
        if i['x'] > max_index:
            max_index = i['x']

        if i['y'] > max_index:
            max_index = i['y']

        if i['z'] > max_index:
            max_index = i['z']

        if i['w'] > max_index:
            max_index = i['w']

    return max_index


def similarity(w_p, w_v, sigma=0.1):
    '''
    w_p (list of size=num_bones)
    w_v (list of size=num_bones)
    '''
    s = 0

    sigma_sq = sigma ** 2
    num_bones = len(w_p)

    for j in range(num_bones):

        for k in range(num_bones):

            if j != k:

                wpj = w_p[j]
                wpk = w_p[k]
                wvj = w_v[j]
                wvk = w_v[k]

                s1 = wpj * wpk * wvj * wvk

                if s1 == 0:
                    continue

                s2 = wpj * wvk - wpk * wvj

                s += s1 * np.exp(- (s2 ** 2) / sigma_sq)

    return s


def triangle_area(t):
    '''
    t: triangle(list of 3 vertices)
    '''
    AB = t[1] - t[0]
    AC = t[2] - t[1]
    return np.linalg.norm(np.cross(AB, AC)) / 2


def cor(wi, faces):

    numer = np.zeros(3)
    denom = 0

    for f in faces:
        s = similarity(wi, f[1])
        numer += s * f[2] * f[0]
        denom += s * f[2]

    if denom < eps:
        return None

    return (numer / denom)


def knn_search(x, D, K):
    """ find K nearest neighbours of data among D """
    ndata = D.shape[0]
    K = K if K < ndata else ndata
    # euclidean distances from the other points
    sqd = np.sqrt(((D - x)**2).sum(axis=1))
    idx = np.argsort(sqd)  # sorting
    # return the indexes of K nearest neighbours
    return idx[:K]


def compute_cor(p, vp, wp, faces, K=1000):
    face_centers = np.array([x[0] for x in faces])

    neares_face_ids = knn_search(vp, face_centers, K)
    neares_faces = [faces[x] for x in neares_face_ids]

    print(p, 'computing cor..')
    c = cor(wp, neares_faces)

    if c is None:
        print(p, 'no cor')
        c = vp
    else:
        print(p, 'cor:', c)

    return (p, c)


def main():

    data_file = 'CORdata.json'
    data = json.load(open(data_file))

    skin_weights = []
    num_bones = get_max_bone_index(data['skinIndices']) + 1
    num_vertices = len(data['vertices'])

    for i in range(num_vertices):

        si = data['skinIndices'][i]
        sw = data['skinWeights'][i]

        w = np.zeros(num_bones)

        for x, j in si.items():
            w[j] = sw[x]

        skin_weights.append(w)

    vertices = []
    for v in data['vertices']:
        vertices.append(np.array([v['x'], v['y'], v['z']]))

    faces = []
    for f in data['faces']:
        a = vertices[f['a']]
        b = vertices[f['b']]
        c = vertices[f['c']]
        area = triangle_area([a, b, c])
        w = (skin_weights[f['a']] + skin_weights[f['b']] + skin_weights[f['c']]) / 3
        v = (a + b + c) / 3
        faces.append([v, w, area])

    # compute_cor(100, vertices[100], skin_weights[100], faces)
    K = 2000

    pool = mp.Pool(processes=10)
    results = [pool.apply_async(compute_cor, args=(x, vertices[x], skin_weights[x], faces, K)) for x in range(num_vertices)]
    output = [p.get() for p in results]

    cors = []
    for cor in output:
        cors.append({
                'p': cor[0],
                'x': cor[1][0],
                'y': cor[1][1],
                'z': cor[1][2],
            })

    with open('cors.json', 'w') as fp:
        json.dump(cors, fp)


if __name__ == '__main__':
    main()