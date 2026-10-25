import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';
import { normalizeBssid, type VerificationPolicy } from '../services/wifi';

const VALID_POLICIES: VerificationPolicy[] = ['GPS_ONLY', 'WIFI_ONLY', 'GPS_OR_WIFI', 'GPS_AND_WIFI'];

/**
 * GET /api/classrooms
 * Returns all active classrooms (for faculty session creation dropdown).
 */
export const listClassrooms = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const result = await pool.query(
            `SELECT id, name, building, latitude, longitude,
                    radius_meters, max_accuracy_meters, verification_policy, is_active, created_at
             FROM classrooms
             WHERE is_active = TRUE
             ORDER BY building ASC NULLS LAST, name ASC`
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error listing classrooms:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * GET /api/classrooms/all
 * Returns ALL classrooms including inactive (faculty admin view).
 */
export const listAllClassrooms = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const result = await pool.query(
            `SELECT id, name, building, latitude, longitude,
                    radius_meters, max_accuracy_meters, verification_policy, is_active, created_at, updated_at
             FROM classrooms
             ORDER BY building ASC NULLS LAST, name ASC`
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error listing all classrooms:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * POST /api/classrooms
 * Creates a new classroom. Faculty only.
 *
 * Body: { name, building?, latitude, longitude, radius_meters?, max_accuracy_meters?, verification_policy? }
 */
export const createClassroom = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const facultyId = req.user?.id;
        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const { name, building, latitude, longitude, radius_meters, max_accuracy_meters, verification_policy } = req.body;

        // Validate required fields
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ message: 'Classroom name is required' });
            return;
        }

        const lat = Number(latitude);
        const lon = Number(longitude);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
            res.status(400).json({ message: 'latitude must be a number between -90 and 90' });
            return;
        }
        if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
            res.status(400).json({ message: 'longitude must be a number between -180 and 180' });
            return;
        }

        const radius = radius_meters !== undefined ? parseInt(radius_meters, 10) : 100;
        if (!Number.isInteger(radius) || radius < 1 || radius > 5000) {
            res.status(400).json({ message: 'radius_meters must be an integer between 1 and 5000 (default: 100)' });
            return;
        }

        const maxAcc = max_accuracy_meters !== undefined ? parseInt(max_accuracy_meters, 10) : 30;
        if (!Number.isInteger(maxAcc) || maxAcc < 1 || maxAcc > 500) {
            res.status(400).json({ message: 'max_accuracy_meters must be an integer between 1 and 500 (default: 30)' });
            return;
        }

        const policy: VerificationPolicy = verification_policy || 'GPS_ONLY';
        if (!VALID_POLICIES.includes(policy)) {
            res.status(400).json({ message: `verification_policy must be one of: ${VALID_POLICIES.join(', ')}` });
            return;
        }

        const result = await pool.query(
            `INSERT INTO classrooms (name, building, latitude, longitude, radius_meters, max_accuracy_meters, verification_policy)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, name, building, latitude, longitude, radius_meters, max_accuracy_meters, verification_policy, is_active, created_at`,
            [name.trim(), building?.trim() || null, lat, lon, radius, maxAcc, policy]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating classroom:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * PATCH /api/classrooms/:id
 * Updates a classroom. Faculty only.
 */
export const updateClassroom = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const facultyId = req.user?.id;
        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const { id } = req.params;
        const { name, building, latitude, longitude, radius_meters, max_accuracy_meters, verification_policy, is_active } = req.body;

        const existing = await pool.query('SELECT id FROM classrooms WHERE id = $1', [id]);
        if (existing.rowCount === 0) {
            res.status(404).json({ message: 'Classroom not found' });
            return;
        }

        const updates: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (name !== undefined) {
            if (typeof name !== 'string' || name.trim().length === 0) {
                res.status(400).json({ message: 'name must be a non-empty string' });
                return;
            }
            updates.push(`name = $${idx++}`);
            params.push(name.trim());
        }
        if (building !== undefined) {
            updates.push(`building = $${idx++}`);
            params.push(building?.trim() || null);
        }
        if (latitude !== undefined) {
            const lat = Number(latitude);
            if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
                res.status(400).json({ message: 'latitude must be between -90 and 90' });
                return;
            }
            updates.push(`latitude = $${idx++}`);
            params.push(lat);
        }
        if (longitude !== undefined) {
            const lon = Number(longitude);
            if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
                res.status(400).json({ message: 'longitude must be between -180 and 180' });
                return;
            }
            updates.push(`longitude = $${idx++}`);
            params.push(lon);
        }
        if (radius_meters !== undefined) {
            const r = parseInt(radius_meters, 10);
            if (!Number.isInteger(r) || r < 1 || r > 5000) {
                res.status(400).json({ message: 'radius_meters must be 1-5000' });
                return;
            }
            updates.push(`radius_meters = $${idx++}`);
            params.push(r);
        }
        if (max_accuracy_meters !== undefined) {
            const m = parseInt(max_accuracy_meters, 10);
            if (!Number.isInteger(m) || m < 1 || m > 500) {
                res.status(400).json({ message: 'max_accuracy_meters must be 1-500' });
                return;
            }
            updates.push(`max_accuracy_meters = $${idx++}`);
            params.push(m);
        }
        if (verification_policy !== undefined) {
            if (!VALID_POLICIES.includes(verification_policy)) {
                res.status(400).json({ message: `verification_policy must be one of: ${VALID_POLICIES.join(', ')}` });
                return;
            }
            updates.push(`verification_policy = $${idx++}`);
            params.push(verification_policy);
        }
        if (is_active !== undefined) {
            updates.push(`is_active = $${idx++}`);
            params.push(Boolean(is_active));
        }

        if (updates.length === 0) {
            res.status(400).json({ message: 'No valid fields to update' });
            return;
        }

        updates.push(`updated_at = NOW()`);
        params.push(id);

        const result = await pool.query(
            `UPDATE classrooms SET ${updates.join(', ')}
             WHERE id = $${idx}
             RETURNING id, name, building, latitude, longitude, radius_meters, max_accuracy_meters, verification_policy, is_active, updated_at`,
            params
        );

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error updating classroom:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * DELETE /api/classrooms/:id
 * Soft-deletes (deactivates) a classroom. Faculty only.
 */
export const deactivateClassroom = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const facultyId = req.user?.id;
        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const { id } = req.params;
        const result = await pool.query(
            `UPDATE classrooms SET is_active = FALSE, updated_at = NOW()
             WHERE id = $1
             RETURNING id, name, is_active`,
            [id]
        );

        if (result.rowCount === 0) {
            res.status(404).json({ message: 'Classroom not found' });
            return;
        }

        res.status(200).json({ message: 'Classroom deactivated', classroom: result.rows[0] });
    } catch (error) {
        console.error('Error deactivating classroom:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Wi-Fi Access Points Management (Faculty Admin)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/classrooms/:classroomId/access-points
 * Lists all registered access points for a classroom.
 */
export const listAccessPoints = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { classroomId } = req.params;
        const result = await pool.query(
            `SELECT id, classroom_id, bssid, ssid, description, is_active, created_at, updated_at
             FROM classroom_access_points
             WHERE classroom_id = $1
             ORDER BY ssid ASC NULLS LAST, bssid ASC`,
            [classroomId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error listing access points:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * POST /api/classrooms/:classroomId/access-points
 * Registers an approved access point for a classroom.
 * Body: { bssid: string, ssid?: string, description?: string, is_active?: boolean }
 */
export const createAccessPoint = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { classroomId } = req.params;
        const { bssid, ssid, description, is_active } = req.body;

        // Verify classroom exists
        const classroomCheck = await pool.query('SELECT id FROM classrooms WHERE id = $1', [classroomId]);
        if (classroomCheck.rowCount === 0) {
            res.status(404).json({ message: 'Classroom not found' });
            return;
        }

        // Validate and normalize BSSID format
        const normalized = normalizeBssid(bssid);
        if (!normalized) {
            res.status(400).json({
                message: 'Invalid BSSID format. Expected 12 hexadecimal characters (e.g. 00:14:22:01:23:45 or 001422012345).'
            });
            return;
        }

        // Check for existing duplicate BSSID for this classroom
        const existing = await pool.query(
            'SELECT id FROM classroom_access_points WHERE classroom_id = $1 AND bssid = $2',
            [classroomId, normalized]
        );
        if (existing.rowCount && existing.rowCount > 0) {
            res.status(409).json({ message: `Access point with BSSID ${normalized} is already registered for this classroom.` });
            return;
        }

        const insertRes = await pool.query(
            `INSERT INTO classroom_access_points (classroom_id, bssid, ssid, description, is_active)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, classroom_id, bssid, ssid, description, is_active, created_at`,
            [
                classroomId,
                normalized,
                ssid?.trim() || null,
                description?.trim() || null,
                is_active !== undefined ? Boolean(is_active) : true
            ]
        );

        res.status(201).json(insertRes.rows[0]);
    } catch (error) {
        console.error('Error creating access point:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * PATCH /api/classrooms/access-points/:id
 * Updates an access point (SSID, description, active status, or BSSID).
 */
export const updateAccessPoint = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { bssid, ssid, description, is_active } = req.body;

        const existing = await pool.query('SELECT id, classroom_id FROM classroom_access_points WHERE id = $1', [id]);
        if (existing.rowCount === 0) {
            res.status(404).json({ message: 'Access point not found' });
            return;
        }

        const updates: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (bssid !== undefined) {
            const normalized = normalizeBssid(bssid);
            if (!normalized) {
                res.status(400).json({ message: 'Invalid BSSID format.' });
                return;
            }
            updates.push(`bssid = $${idx++}`);
            params.push(normalized);
        }
        if (ssid !== undefined) {
            updates.push(`ssid = $${idx++}`);
            params.push(ssid?.trim() || null);
        }
        if (description !== undefined) {
            updates.push(`description = $${idx++}`);
            params.push(description?.trim() || null);
        }
        if (is_active !== undefined) {
            updates.push(`is_active = $${idx++}`);
            params.push(Boolean(is_active));
        }

        if (updates.length === 0) {
            res.status(400).json({ message: 'No valid fields to update' });
            return;
        }

        updates.push(`updated_at = NOW()`);
        params.push(id);

        const result = await pool.query(
            `UPDATE classroom_access_points SET ${updates.join(', ')}
             WHERE id = $${idx}
             RETURNING id, classroom_id, bssid, ssid, description, is_active, updated_at`,
            params
        );

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error updating access point:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * DELETE /api/classrooms/access-points/:id
 * Deletes or disables an access point.
 */
export const deleteAccessPoint = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `DELETE FROM classroom_access_points WHERE id = $1 RETURNING id, bssid, classroom_id`,
            [id]
        );

        if (result.rowCount === 0) {
            res.status(404).json({ message: 'Access point not found' });
            return;
        }

        res.status(200).json({ message: 'Access point deleted', accessPoint: result.rows[0] });
    } catch (error) {
        console.error('Error deleting access point:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
